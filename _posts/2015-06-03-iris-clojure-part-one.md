---
layout: post
title: Iris/Clojure Introduction (Part I)
summary: A skimming over of integrating Clojure into the Iris decentralized messaging system.
author:     Moe Aboulkheir
categories: clojure iris messaging
tags: clojure iris messaging
---

## Motivation

You may remember from [my post on
Hildebrand](https://nervous.io/clojure/aws/dynamo/hildebrand/2015/06/08/hildebrand/)
(a rollick, recommended for all) that we're interested in the migration of human
minds into more resilient substrates.

Given the orgy of electrified axoplasm riveting your meat puppet at this moment,
it's facile to suggest that the promiscuous interconnection of services may be a
prerequisite for sentient systems.  We know it is.

The sober among us acknowledge we're far from determining the kinds of
information these systems ought to best process, or how best to process it.  So
we process everything, with idiot hope.  Map juggling services, throwing maps at
map juggling services.

<blockquote class="quote">
<p>
<br>The dead, the gentle dead - who knows? -<br>
In tungsten filaments abide,<br>
And on my bedside table glows<br>
Another man's departed bride.<br><br>
</p>
<p>- John Shade, <i>"The Nature of Electricity"</i></p>
</blockquote>

<div class="footnote">
N.B. <small>
See also the second article in this series: <a href="/clojure/iris/messaging/2015/06/16/iris-clojure-part-two/">Iris & Clojure Part II: Tunneling</a>.
</small>
</div>


## <a name="iris" id="iris"></a> Iris Preamble

(I could be horrifically, accidentally misrepresenting things - please correct me.)

[Iris](http://iris.karalabe.com/) is an unbrokered messaging system centered
around routing data between providers & consumers of named services.  With the
proviso that the nodes coexist within an IPv4 subnetwork, compatible Iris peers will
be discovered via address probing (using a strategy optimized for
provisioned-computing environments).

In Iris terminology, an interconnected group providing a named service constitutes
a _micro-service cluster_, or _service cluster_.  To connect to a service is to
address a service cluster: individual nodes are not addressable.

<div class="footnote">
N.B. <small>
To allow isolation within a subnet, Iris processes can be started with a network
name (the <code>-net</code> command line argument).  These networks are occasionally
referred to as clusters - we'll be consistently using <i>network</i>, as a means of
avoiding confusing them with service clusters.
</small>
</div>

From the perspective of application code, participation in a network is
initiated by connecting to a local Iris process, which in turn will have
autonomously connected to any discoverable Iris processes on nearby machines.
High-level instructions are submitted to the local process via, in our case, a
Java API.  Outside of the JVM, Erlang & Go clients exist - the Iris process is
itself implemented in Go.

To the end of tying this together, let's imagine we're only running one Iris
process per logical host, with each Iris process servicing a single local
client (a piece of our application code).  Some hosts are involved in a
development Iris network (`-net dev`), some in a test Iris network (`-net
test`).  This is what it may look like:

![Iris](https://nervous.io/images/iris.png)

The circles represent the only addressable units within our universe - service
providers and topic subscribers. Each side of the diagram is forever ignorant of
the other, with both ignorant of whatever else may be happening in other
subnetworks.  The squares represent individual nodes.  The uncircled
squares are neither providing nor subscribing - they could be publishing,
consuming services, or idling.

We can choose from these modes of communication:

 - **request/response** "I want to ask this of any member of the _X_ service cluster within my Iris network"
 - **broadcast** "I want to tell this to all members of the _X_ service cluster within my Iris network"
 - **tunnel** "I want a stateful connection to any member of the _X_ service cluster within my Iris network"
 - **publish/subscribe** "Notify all subscribers to topic _X_ within my Iris network"

Note that the topics addressed in publish/subscribe requests exist in a
different namespace to service names.

## The Meat

There's an [iris-examples repository
here](https://github.com/nervous-systems/iris-examples), where this code exists
in entirety.  I'm going to narrate some extracts of a very simple
request/response example below, in a totally non-overwhelming way.  In
subsequent posts, we'll cover the other communication modes.

### Running The Example

(Assuming an Iris process is listening locally, e.g. `iris -dev`)

```sh
$ git clone https://github.com/nervous-systems/iris-examples.git
$ cd iris-examples/
$ lein run -m iris-examples.req-resp.service [--port 55555]
$ lein run -m iris-examples.req-resp.client  [--port 55555]
```

The service can be started as many times as you like - in
the log output, you'll see the requests partitioned between however many you're
running.

### The Service

We'd like a small chunk of functionality which doesn't do anything too exotic,
and is in no way coupled with Iris:

```clojure
(defmulti  bit-service :command)
(defmethod bit-service :default [_]
  (throw (Exception. "Unknown command!")))

(defmethod bit-service :random [_]
  (rand-int 2))

(defmethod bit-service :shift [{:keys [number places direction]}]
  (case direction
    :left  (bit-shift-left  number places)
    :right (bit-shift-right number places)))
```

As you can see, `bit-service` accepts a map and dispatches on the value of the
`:command` key.  The `:random` command will result in either `0` or `1`, while
`:shift` grabs some other keys and returns a number.

We'll share this sliver of delight like it's nothing:

```clojure
(ns iris-examples.req-resp.service
  (:require [iris-examples.common :as common])
  (:import [com.karalabe.iris ServiceHandler Service]
           [com.karalabe.iris.exceptions RemoteException]))

;; Omitted bit-service definition goes here

(defn create-handler []
  (reify ServiceHandler
    (handleRequest [_ byte-array]
      (try
        (-> byte-array
            common/unpack-message
            bit-service
            common/pack-message)
        (catch Exception e
          (throw (RemoteException. (.getMessage e) e)))))))

(defn -main []
  (Service. 55555 "bit-service" (create-handler)))
```

<div class="footnote">
N.B. <small>The two functions called from <code>common</code> are using <a
href="https://github.com/cognitect/transit-format">Transit</a> to squish Clojure
data structures into byte arrays, and also read them out.  They're not covered
in this post, but the <a href="https://github.com/nervous-systems/iris-examples/blob/master/src/iris_examples/common.clj#L6">source is available</a> as part of the project.</small>
</div>

To join/create a service cluster with Iris, we're required
to provide an implementation of
[ServiceHandler](http://codenav.org/code.html?project=/com/karalabe/iris/iris/1.0.0-preview-3&path=/Source
Packages/com.karalabe.iris/ServiceHandler.java).  This isn't as unfair as it
sounds, given that its a fairly straightforward interface with default methods
(the Java Iris client requires Java 8) - we only implement the callbacks we care about.

Requests are submitted as opaque byte arrays by the invoking side, and arrive on
the invoked side as identical byte arrays.  A `ServiceHandler.handleRequest`
implementation takes such a byte array, perhaps does something with it, and
returns a byte array to be conveyed to the invoker.

Service-side errors will be relayed as strings to the calling side, if wrapped
in `RemoteException`.  We're doing this coarsely, because it would be excessive
to implement a richer, application-level error mechanism for this example.

### The Client

First, let's make a simple function which will generate an input for
`bit-service` - either requesting a random bit, a bit shift, or supplying an
invalid command:

```clojure
(defn random-request []
  (let [cmd (rand-nth [:random :shift :super-invalid])]
    (cond-> {:command cmd}
      (= cmd :shift) (conj {:direction (rand-nth [:left :right])
                            :number (rand-int 10)
                            :places (rand-int 10)}))))
```

Now, it seems sensible to write a function which takes a connection to Iris and
a `bit-service` request (i.e. a map, as returned from `random-request`),
submitting the request for remote processing:

```clojure
(ns iris-examples.req-resp.client
  (:require [iris-examples.common :as common]))

(defn make-noisy-request! [conn req]
  (try
    (let [resp (.request conn "bit-service"
                         (common/pack-message req) 1000)]
      (log-response req resp)
      true)
    (catch Exception e
      (log-response-error req e)
      nil)))
```

The eye goes to:

```clojure
(.request conn "bit-service" (common/pack-message req) 1000)
```

Where `conn` is a
[Connection](http://codenav.org/code.html?project=/com/karalabe/iris/iris/1.0.0-preview-3&path=/Source%20Packages/com.karalabe.iris/Connection.java)
instance, keeping us in touch with our local Iris process.  We're asking Iris to
send off a byte array (as returned by `pack-message`) to the `bit-service`
micro-service cluster, which is hopefully populated by at least one instance of the
server example above.

If operating Iris in development mode, the other members of the service cluster
will be living on the same machine as this client, or even in the same
process.  That's immaterial - the code isn't going to change if things grow.

The final argument to `request` is a millisecond timeout - the maximum delay for
which we're willing to wait for a response.

<div class="infobox">
<div class="infobox-title">Protip</div>
<p>
If the request cannot be serviced (e.g. because there are no members in the
cluster), the request timeout is the duration for which you will wait (block) to find
that out.
</p>
</div>
The client entrypoint:

```clojure
(defn -main []
  (let [conn (Connection. 55555)]
    (loop []
      (if (make-noisy-request! conn (random-request))
        (recur)
        (.close conn)))))
```

We issue our randomly generated requests, terminating after the first error.

### Roundup

In the next posts in this series, we'll cover the remaining Iris communication
patterns with more involved examples, and look at integrating Iris into an
environment where we have to be a little more careful about where we block.

_Update: [Iris & Clojure Part II: Tunneling](/clojure/iris/messaging/2015/06/16/iris-clojure-part-two/)._



