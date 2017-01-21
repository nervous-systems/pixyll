---
layout:     post
title:      Clojure & Dynamo Streams, Briefly
date:   2015-07-01 16:28:29
summary:    A short post demonstrating asynchronous use of the DynamoDB Streams API preview from Clojure.
author:     Moe Aboulkheir
thumbnail: /images/streams-thumb.png
categories: clojure aws dynamo hildebrand streams
tags: clojure aws dynamo hildebrand streams
---

## Introduction To Streams

[Dynamo
Streams](http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html)
is an AWS service which allows [Dynamo](http://aws.amazon.com/dynamodb) item
writes (inserts, modifications, deletions) to be accessed as per-table streams
of data.  It's currently in preview-only mode, however there's a [version of
DynamoDB
Local](http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html)
which implements the API.

The interface is basically a subset of [Amazon's Kinesis stream-consumption
API](http://aws.amazon.com/kinesis/), and there's an [adaptor
library](http://dynamodb-preview.s3-website-us-west-2.amazonaws.com/docs/streams-dg/Streams.KCLAdapter.Walkthrough.html)
which allows applications to consume Dynamo streams as if they were originating
from Kinesis.  In additon to direct/pull consumption, Dynamo streams can be
associated with [AWS Lambda](http://aws.amazon.com/documentation/lambda/)
functions.

## From Clojure

Support for streams is included in the recently-minted 0.3.0 version of
[Hildebrand](https://github.com/nervous-systems/hildebrand), a Clojure DynamoDB
client (covered in giddy detail [in a previous
post](/clojure/aws/dynamo/hildebrand/2015/06/01/hildebrand/)).  Consider all of
the details provisional, given the preview nature of the API.

The operations below assume a table exists with streams enabled, with both new
and old images included (i.e. before-and-after snapshots, for updates).
Creating one would be accomplished like so, with Hildebrand:

```clojure
(hildebrand/create-table!
  {:secret-key ... :access-key ...
   :endpoint "http://localhost:8000"}
  {:table :stream-me
   :attrs {:name :string}
   :keys [:name]
   ...
   :stream-specification
   {:stream-enabled true
    :stream-view-type :new-and-old-images}})
```

Note we're pointing the client at a local Dynamo instance.  Now, let's listen to any updates:

```clojure
(ns ...
  (:require [clojure.core.async :refer [<! go]]
            [hildebrand.streams :refer
             [latest-stream-id! describe-stream!]]
            [hildebrand.streams.page :refer [get-records!]]))

(defn read! []
  (go
    (let [stream-id (<! (latest-stream-id! creds :stream-me))
          shard-id  (-> (describe-stream! creds stream-id)
                        <! :shards last :shard-id)
          stream    (get-records! creds stream-id shard-id
                      :latest {:limit 100})]
      (loop []
        (when-let [rec (<! stream)]
          (println rec)
          (recur))))))
```

We retrieve the latest stream ID for our table, and then the identifier of the
last shard for that stream.  The streams documentation isn't forthcoming on the
details of how and when streams are partitioned into shards - we're only
interested in the most recent items, so this logic will do for a demo.

`get-records!` is the only non-obvious function above - it continually fetches
updates (`limit` at a time) from the shard using an internal iterator.  Updates
are placed on the output channel (with a buffer of `limit`) as vectors tagged
with either `:insert`, `:modify` or `:remove`.

`:latest` is the iterator type - per Dynamo, the other options are
`:trim-horizon`, `:at-sequence-number` and `:from-sequence-number`.  For the
latter two, a sequence number can be provided under the `:sequence-number` key
in the final argument to `get-records!`

Let's write some items to our table:

```clojure
(defn write! []
  (async/go-loop [i 0]
    (<! (put-item! creds :stream-me {:name "test" :count i}))
    (<! (update-item!
         creds :stream-me {:name "test"} {:count [:inc 1]}))
    (<! (delete-item! creds :stream-me {:name "test"}))
    (recur (inc i))))
```

Running these two functions concurrently, we'd see this output:

```clojure
[:insert {:name "test" :count 0}]
[:modify {:name "test" :count 0} {:name "test" :count 1}]
[:delete {:name "test" :count 1}]
...
```

The sequence numbers of the updates are available in the metadata of each of the
vectors.


