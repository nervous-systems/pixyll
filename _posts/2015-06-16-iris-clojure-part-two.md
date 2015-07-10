---
layout: post
title: Iris & Clojure Part II - Tunneling
summary: The second part in a series on integrating Clojure into the Iris decentralized messaging system.
author:     Moe Aboulkheir
date:       2015-06-16 16:12:29
categories: clojure iris messaging
tags: clojure iris messaging
---

## Introduction

Our interest in Iris, you'll recall, is as a vector for the ruminations of a
synthetic intelligence.  Last week's partially implemented binary calculator
could be next week's goal-weighting subsystem.

This interest finds us at the lonely intersection of the mystical tradition and
the echo protocol.  Incessantly resounding inanity, we hope, will create space
for the profound.  A space in which the echoes of our pitiful utterances will
return to us, shimmering in meaning.

In these reflections of our ignorance, we hope to find knowledge.

## Tunneling

Disguised by excesses of expression, the [previous article on Clojure &
Iris](/clojure/iris/messaging/2015/06/03/iris-clojure-part-one/) contains a
[solid
introduction](/clojure/iris/messaging/2015/06/03/iris-clojure-part-one/#iris) to
some of the underlying ideas - we'll be working from that.

In Iris, we address clusters of services, never individual participants.  When
requesting a tunnel, we're asking that some (i.e. any) available purveyor of a
service engage with us in an ordered, stateful connection.

We're going to use Clojure and
[core.async](https://github.com/clojure/core.async) to implement a perversely
tunneled version of `echo`.  You're correct in suspecting that `echo`, while
ordered, may not fully exercise the _stateful_ portion of the tunnel brief.

No strangers to innovation, we're going to add a `last` command.

### Running The Code

There's an [iris-examples repository
here](https://github.com/nervous-systems/iris-examples), where the below code
can be found, alongside short examples of the other communication modes.  The module we're talking about is [iris-examples.tunnel](https://github.com/nervous-systems/iris-examples/blob/master/src/iris_examples/tunnel.clj).

Assuming an Iris relay is running locally (e.g. `iris -dev`):

```sh
$ git clone https://github.com/nervous-systems/iris-examples.git
$ cd iris-examples/
$ lein run -m iris-examples.tunnel [--port 55555]
```

The above invocation will start accepting and initiating tunnel requests (to
itself, via the relay, if no other processes are connected).

### Writing The Echo Client

We'd like to keep our client focused on the echoing of things,
 ignoring as much as possible about what may be happening beneath.  Its contract
 is simple: write, read, repeat.

First, we accept a channel to which we write a command.  Commands are vectors:

```clojure
[:echo <anything>]
[:last]
```

We then read the response, and repeat, aware that the channel may close at any
time.

```clojure
(ns iris-examples.tunnel
  (:require [clojure.data.generators :as gen]
            [clojure.core.async :as async :refer [<! >!]]
            ...))

(defn echo-client! [chan]
  (async/go-loop [echo true]
    (let [op (if echo
               [:echo (gen/anything)]
               [:last])]
      (>! chan op))
    (when-let [response (<! chan)]
      (log/info response)
      (recur (not echo)))))
```

We alternate between requesting the `:echo` of a randomly-generated Clojure data
structure, and asking for the repetition of the `:last` input, terminating when
the channel closes.

### Echo Server

The contract for the server is also extremely simple: read, write, repeat,
terminating on channel closure.

```clojure
(defn echo-server! [chan]
  (async/go-loop [last-value nil]
    (when-let [[command in-value] (<! chan)]
      (let [value (case command
                    :last last-value
                    :echo in-value)]
        (>! chan [command value])
        (recur value)))))
```

<div class="footnote">
N.B. <small>We're lazily using <code>when-let</code> in these examples instead of explicitly
checking for <code>nil</code> (the closed-channel sentinel value) because we know that no other false value
is going to pass through the service.</small>
</div>

Let's go ahead and add one more awkward feature to echo, which'll require that
the server know a little more about the world.  Half the time, when receiving an
`:echo` from the client, we'll initiate a tunnel to some other echo server, and
defer the request to it.  These nested tunnels will modify the output, so, e.g.

```clojure
[:echo [:echo [:echo <input>]]]
```

Indicates a response which went through three instances of the echo server.

```clojure
(defn echo-server! [chan tunnel!]
  (async/go-loop [last-value nil]
    (when-let [[command value :as op] (<! chan)]
      (case command
        :last (>! chan [:last last-value])
        :echo (if (zero? (rand-int 2))
                (let [proxy-chan (tunnel!)]
                  (>! proxy-chan [:echo op])
                  (>! chan (<! proxy-chan))
                  (async/close! proxy-chan))
                (>! chan op)))
      (recur value))))
```

We now have a `tunnel!` argument, a function which somehow returns a client
channel (attached to another echo server) to which we write the request - after
wrapping it in another `:echo` vector, for effect.

For the sake of brevity, we ignore the possibility that we're unable to read a
value from the proxy channel - if that happens, the server will blow up when we
try to write the resulting `nil` to our client's channel.

### Iris Machinery

Let's take a look at how we turn a [Tunnel](http://codenav.org/code.html?project=/com/karalabe/iris/iris/1.0.0-preview-3&path=/Source%20Packages/com.karalabe.iris/Tunnel.java) object into a channel:

```clojure
(defn tunnel-wrapper [read-or-write tunnel & [{:keys [chan]}]]
  (let [chan (or chan (async/chan))]
    (async/thread
      (when (or (= read-or-write :write)
                (some->> tunnel receive!! (>!! chan)))
        (loop []
          (when-let [out-value (<!! chan)]
            (send!! tunnel out-value)
            (when-let [in-value (receive!! tunnel)]
              (when (>!! chan in-value)
                (recur)))))
        (close! tunnel)
        (async/close! chan)))
    chan))
```

Alongside the tunnel itself, `tunnel-wrapper` accepts either `:read` or
`:write`, indicating the first operation we'd like to perform on the tunnel -
clients want to `:write`, servers want to `:read`.  It then alternates these
operations until it doesn't read anything, or the async channel it's writing to
has been closed.

At the Iris level, tunnel writes will block briefly until the request has been
handed off to the local relay.  Reads (there's an explicit timeout option) will
block until data is received from the wire.  Predictably, both of these
operations will error if the tunnel is torn down.

```clojure
(defn receive!! [^Tunnel tunnel]
  (try
    (common/unpack-message (.receive tunnel))
    (catch ClosedException _
      nil)))

(defn send!! [^Tunnel tunnel value]
  (.send tunnel (common/pack-message value)))
```

The wire format is [msgpack, via
Transit](https://github.com/nervous-systems/iris-examples/blob/master/src/iris_examples/common.clj).

As shown above, these two blocking operations are performed in a thread within
the tunnel wrapper.

<div class="footnote">
N.B. <small>The threads created by Iris on tunnel receipt (in which your implementation of <code>ServiceHandler.handleTunnel</code> will be executed) are unbounded in number, and <code>async/thread</code> above, is similarly unconstrained.</small>
</div>

#### Module Entrypoint

```clojure
(defn tunnel!! [^Connection conn & [opts]]
  (let [tunnel (.tunnel conn "echo-service" 1000)]
    (tunnel-wrapper :write tunnel opts)))

(defn tunnel! [conn]
  (let [chan (async/chan)]
    (async/thread-call #(tunnel!! conn {:chan chan}))
    chan))

(defn create-handler [tunnel-callback]
  (reify ServiceHandler
    (handleTunnel [_ tunnel]
      (tunnel-callback (tunnel-wrapper :read tunnel)))))

(defn -main [& args]
  (let [port (common/cli-args->port args)
        conn (Connection. port)]
    (Service. port "echo-service"
              (create-handler
               #(echo-server! % (partial tunnel! conn))))
    (echo-client! (tunnel!! conn))))
```

We register a
[Service](http://codenav.org/code.html?project=/com/karalabe/iris/iris/1.0.0-preview-3&path=/Source%20Packages/com.karalabe.iris/Service.java)
with Iris, under the name "echo-service", asking that requests be delegated to
our implementation of [ServiceHandler](http://codenav.org/code.html?project=/com/karalabe/iris/iris/1.0.0-preview-3&path=/Source%20Packages/com.karalabe.iris/ServiceHandler.java).  The handler's method (`handleTunnel`)
invokes the `echo-server!`, passing it a wrapped version of
the incoming
[Tunnel](http://codenav.org/code.html?project=/com/karalabe/iris/iris/1.0.0-preview-3&path=/Source%20Packages/com.karalabe.iris/Tunnel.java)
instance.

Finally, we grab a tunnel (we block, it's prison rules in `-main`) and launch a client.

## Conclusion

It looks like we've successfully isolated the blocking/Iris-specific parts
of tunnel negotiation from our channeled client & server.

Hopefully the Iris interop bits weren't too awkward to follow.  Going through
the [interface
definitions](http://codenav.org/code.html?project=/com/karalabe/iris/iris/1.0.0-preview-3&path=/Source%20Packages/com.karalabe.iris/ServiceHandler.java),
and reading the [code from above in
full](https://github.com/nervous-systems/iris-examples/blob/master/src/iris_examples/tunnel.clj)
should make things clearer.

Here's what the output looks like when run:

```
...
15:15:41.791 INFO  Constructing outbound tunnel
15:15:41.791 INFO  Tunnel construction completed
15:15:41.791 INFO  Accepting inbound tunnel
15:15:42.807 INFO  Tunnel acceptance completed
15:15:42.811 INFO  > [:echo X?:gT~*xo*(b1+)]
15:15:42.813 INFO  < [:echo [:echo [:echo X?:gT~*xo*(b1+)]]
15:15:43.314 INFO  > [:last]
15:15:43.318 INFO  < [:last X?:gT~*xo*(b1+)we2PN>IhgmSF0yM]
15:15:43.819 INFO  > [:echo 5315513648914277925/47064]
15:15:43.823 INFO  < [:echo 5315513648914277925/47064]
...
```