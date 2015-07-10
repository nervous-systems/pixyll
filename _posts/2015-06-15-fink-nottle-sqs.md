---
layout: post
title: Queuing on EC2 with core.async
summary: Asynchronous queueing and consumption of SQS messages with Clojure.
author: Moe Aboulkheir
categories: clojure aws async sqs messaging
tags: clojure aws async sqs messaging
---

## Background

Last week we  [began talking about
Iris](/clojure/iris/messaging/2015/06/03/iris-clojure-part-one/) as a means
of transmitting <strike>mostly empty maps</strike> nerve impulses between
<strike>our two webservers</strike> subsystems of the beneficent and rapidly
tumefying superintelligence we're all collaborating on.

Looking inside our creation, observing the traffic which holds it together, we
see that not all messages are similarly disposed.  Some mope in narrowing
circles.  Others flit with vitality and ambition, mocking our attempts to
confine them.

Outside, stories of The Work spread.  Phones and wristwatches whir at the
promise of deciding even a single, imperceptible pixel in the corner of its
daydreams.

## Technology

This post will focus on using Amazon's queuing service, SQS, in conjunction with
Clojure & [core.async](https://github.com/clojure/core.async).  It will be
shortly followed by less interesting post covering SNS.

### [SQS](http://aws.amazon.com/sqs/)

Named after a minor Greek god, SQS is an Amazon-hosted queue service, with no
ordering guarantees and explicit receipt confirmation.  It allows delivery of
messages across EC2 regions, as well as between AWS accounts.  The receive API
is based on HTTP long-polling, a detail we'll abstract with channels.

### [Fink-Nottle](https://github.com/nervous-systems/fink-nottle)

Fink-Nottle is a Clojure library which tries to expose all of the features of
SQS (and its cousin, [SNS](http://aws.amazon.com/sns/)) via a consistent,
asynchronous API.  It's built on top of
[Eulalie](https://github.com/nervous-systems/eulalie), an
[httpkit](http://www.http-kit.org/)-based AWS client library.

As a name, _Fink-Nottle_ primarily exudes Saturn energy, and so resonates
harmoniously with the malefic half-planet Ketu, which governs SQS.  The
reluctant and repressed Moon energy of SNS will be harder work.

## Examples

Through a series of narrated excerpts, we're going to make it as easy as
possible to get started.  There's a small [Github
repository](https://github.com/nervous-systems/fink-nottle-demo) containing a
runnable version of this code.

All of the functions we'll be talking about accept (at least) an AWS credentials
map (`:secret-key`, `:access-key`, optionally `:region`, `:token`) and return
asynchronous channels to which one or more result values will be written.
Synchronous versions of all of the SQS API-level functions are available.

### Creating Queues

SQS queues are created by passing symbolic names to `create-queue!`, which
returns a channel populated with the queue's URL.

```clojure
(sqs/create-queue! creds "fink-nottle-tasks-demo")
```

That's more or less the last you'll hear of this name - the SQS API almost
exlusively refers to existing queues by URL, with the exception of embedded
policy documents, and so on, which use ARNs (_Amazon Resource Names_).

<div class="infobox">
<p>
Entity creation in SQS (and SNS) is generally idempotent - as long as you're
consistent (i.e. in terms of configuration), you can repeatedly use the creation
API without getting different URL/ARN values.  It's probably best to not count
on this feature in serious code, though.
</p>
</div>

### Simple Send/Receive

```clojure
(ns fink-nottle-demo.sqs
  (:require [fink-nottle.sqs :as sqs]
            [fink-nottle.sqs.channeled :as sqs.channeled]
            ...))

(defn receive-loop! [creds queue-url]
  (let [messages (sqs.channeled/receive! creds queue-url)]
    (go
      (loop []
        (let [{:keys [body attrs] :as message} (<! messages)]
          ;; Maybe do something with the message
          (recur))))))
```

<div class="footnote">
N.B. <small> For the sake of simplicity, the code samples
may not explicitly deal with errors.  In the sample above, the take from the
<code>messages</code> channel could yield an exception.
</small>
</div>

`sqs.channeled/receive!` is giving us a channel which it'll populate with map representations
of messages consumed from the given queue.  By default, these will be received
from SQS up to 10 at a time (the maximum per request), with each request parking
for up to 20 seconds if no messages are available.

The most interesting components of the message map are `:body` (a string, as far
as SQS is concerned - more of which below) and `:attrs`, a map of message
attributes with types of either string, number, or binary (byte array).

```clojure
(defn send-loop! [creds queue-url]
  (go
    (loop [i 0]
      (<! (sqs/send-message!
           creds queue-url {:body "Hello" :attrs {:i i}})
      (<! (async/timeout 1000))
      (recur (inc i)))))
```

Super vanilla.  We're sending a string body, a single number attribute, and
waiting a second in between sends.

### Deletion

If the two examples above were running concurrently, we'd eventually see some
strange behaviour in `receive-loop!`.  As none of the incoming messages are being
actively deleted, after an interval (which defaults to 30 seconds), SQS will
attempt redelivery to the same queue.

```clojure
(<! (sqs/processed! creds message))
```

Placing the above call in the receive loop would prevent this behaviour.  There
is a lower-level function, `sqs/delete-message!` which accepts `:receipt-handle`
from within the message map, but they're doing exactly the same thing.

### Structured Messages

Fink-Nottle provides a very simple means of applying functions to message bodies
at send & receive time, conditioned by a tag in the message map.  Here's an
example of something we could do with it:

```clojure
(defmethod sqs.tagged/message-in  :edn [_ body]
  (clojure.edn/read-string body))
(defmethod sqs.tagged/message-out :edn [_ body] (pr-str body))

(sqs/send-message!
 creds queue-url
 {:body {:event :increment :value i}
  :fink-nottle/tag :edn})
```

Messages received within reach of the above `message-in` definition will be read
as Clojure data structures.

### Batching Writes

As SQS is billed per-request<sup>1</sup>, we probably ought to use the batch
sending API, which allows up to 10 messages at a time to be sent for the price
of one.  Fink-Nottle makes this pretty easy:

```clojure
(let [{:keys [in-chan error-chan]}
      (sqs.channeled/batching-sends creds queue-url)]
  (>! in-chan {:body {:event :increment :value i}
               :fink-nottle/tag :edn}))
  ;; ...

```

When occurring within a configurable window, writes on the `in-chan` received
from `batching-channel` will be grouped together before being sent to SQS.  With
the default behaviour, if any of the sends results in an error, subsequent
writes will park until `error-chan` has been consumed.

We can get identical behaviour for deletes by using
`sqs.channeled/batching-deletes`.

<div class="footnote"><sup>1</sup> <small>The first million per month are free.
</small></div>

### Combining The Above Features

```clojure
(defn send-loop! [creds queue-url]
  (let [{:keys [in-chan]}
        (channeled/batching-sends creds queue-url)]
    (go
      (loop [i 0]
        (>! in-chan {:body {:event :increment :value i}
                     :fink-nottle/tag :edn})
        (<! (async/timeout (rand-int 300)))
        (recur (inc i))))))

(defn receive-loop! [id creds queue-url]
  (let [messages (channeled/receive! creds queue-url)
        {deletes :in-chan}
        (channeled/batching-deletes creds queue-url)]
    (go
      (loop []
        (let [{:keys [body attrs] :as message} (<! messages)]
          ;; ...
          (>! deletes message)
          (recur))))))
```

### Bonus Round: Dead Letter Queues

We can ask SQS to remove messages from a given queue and place them on another
when some unsucessful delivery threshold is reached (i.e. if a message has been
returned N times from a `receive-message` call without being deleted).

To add this feature to an existing queue, we'd do something like:

```clojure
(sqs/set-queue-attribute!
 creds queue-url
 :redrive-policy
 {:max-receive-count 2
  :dead-letter-target-arn dead-letter-queue-arn})
```

The ARN for a queue is obtained with `sqs/queue-arn!`

## Closing

SQS/Fink-Nottle support additional features not covered in this post - queue
purging, fine-grained permissions, manipulation of visibility
per message, etc.

In the follow-up on the SNS portion of Fink-Nottle, we'll try to cover pushing
of messages to SQS queues, as well as to mobile devices.

