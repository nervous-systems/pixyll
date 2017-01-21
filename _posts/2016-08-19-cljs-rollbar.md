---
layout: post
title: Clojurescript Rollbar Support
summary: A small Clojurescript library for reporting errors / application events.
date:       2016-08-19 14:15:00
author: Moe Aboulkheir
categories: clojurescript node
tags:       aws lambda utilities
---

# Motivation

One of my clients has a significant number of [Clojurescript AWS Lambda
functions](https://github.com/nervous-systems/cljs-lambda), constituting the
backend portion of a mobile & web app.  While CloudWatch can be super-helpful
for tracing errors, we wanted a higher-level means of tracking faults and
associating arbitrary data with them --- with configurable notifications
across multiple channels.

<div class="thumbnail-right">
<img src="/images/rollbar-occurences.png" />
</div>

[Rollbar](https://rollbar.com) is a service with a spartan, but effective web UI,
and backend well-integrated with third-party services (Slack, and so
on). It's also extremely flexible when it comes to reporting ---
arbitrarily structured JSON attached to log message/errors,
pre-defined slots for user identification, request variables, etc.

# Library

[cljs-rollbar](https://github.com/nervous-systems/cljs-rollbar) is an easy to
use, inventively named Rollbar client written in Clojurescript<sup>1</sup>, with
support for [Timbre](https://github.com/ptaoussanis/timbre) (flexible logging
library) and [cljs-lambda](https://github.com/nervous-systems/cljs-lambda)
(Clojurescript on [AWS
Lambda](http://docs.aws.amazon.com/lambda/latest/dg/welcome.html)).

There's a core module, with smaller environment-specific modules responsible for
defining sensible platform defaults (e.g. machine identifier, platform name,
etc.) which'll be included in requests.

Version `0.1.0` only ships with a
[cljs-rollbar.node](https://github.com/nervous-systems/cljs-rollbar/blob/master/src/cljs_rollbar/node.cljs)
namespace, however I encourage anyone interested in browser support (or JVM
support) to add it (all of the third-party libraries - promises, HTTP, etc. are
dual-target).

<div class="footnote"><sup>1</sup> <small>There's no reason it couldn't also run
on the JVM with some trivial modifications.  There's a <a href="https://github.com/circleci/rollcage">pre-existing Clojure
client, Rollcage</a>, though having a single
API available on multiple targets seems like it'd be helpful.</small> </div>

# API

There's a function, `rollbar!`, which takes a map, moves some stuff around then
issues it as the body of POST request to the Rollbar API, returning a
[promesa](https://github.com/funcool/promesa/blob/master/project.clj) promise.

```clojure
(...
  (:require [cljs-rollbar.core :as rollbar]
            [cljs-rollbar.node]))

(def report!
  (-> rollbar/rollbar!
      (rollbar/defaulting cljs-rollbar.node/default-payload)
      (rollbar/defaulting {:token "SECRET"})))
```

<small class="commentary">(I'm going to try not to say _middleware_, but the
pattern above may be unsurprising, or tedious, depending on your
experiences.)</small>

`:token` is required by Rollbar (in this case it's a _server token_), as are a
couple of the values which occur in `default-payload` - see the [Rollbar API
reference](https://rollbar.com/docs/api/items_post/) for more details.

The simplest possible request we could issue with the above function:

```clojure
(report! {:info "Hello"})
```

POW.

## I'd Like to Hear More

Our `report!` function (which in real life'd probably be more helpfully named
`rollbar!`) takes a map containing a log level and a value (either a string or
an `Error` instance), and whatever other keys --- arbitrary or Rollbar-preset
--- we think are going to be helpful in describing it.

Calling the function returns a promise which'll resolve with Rollbar's response
- hopefully a UUID indicating receipt of the message.  Mostly we're not going to
care too much about that half of things.

### What Actually Happens?

In a Node REPL on my laptop with the above `report!` definition, the body of the request to Rollbar ends up looking like:

```clojure
{:access_token "SECRET"
 :data
 {:server
  {:code_version "0.1.0"
   :host         "brinstar.local"
   :argv         ["/usr/local/Cellar/node/6.3.1/bin/node"]
   :pid          69652}

  :level       :info
  :language    "clojurescript"
  :notifier    {:name "rollbar-cljs-node" :version "0.1.0"}
  :environment "unspecified"
  :timestamp   1470412615834
  :body        {:message {:body "Hello"}}
  :framework   "node-js"
  :platform    "darwin"}}
```

If any of those values appear misleading or offensive, better ones may be specified, either when we define the reporter:

```clojure
(def report!
  (-> rollbar/rollbar!
      (rollbar/defaulting {:env "prod"})
      ...))
```

<p class="small">(<code>:env</code> is a supported abbreviation, as are <code>:host</code> and <code>:version</code>)</p>

Or in an individual message:

```clojure
(report! {:info "Hello" :env "prod" :version "0.0.0"})
```

## More Fun With Reporting

Rollbar has some pre-defined slots for event metadata which can be used to find
patterns across different event types - triggered by the same user, parameter,
etc.  An example using Rollbar's concept of "person":

```clojure
(report! {:error (ex-info "Oops" {:x 1}) :person {:id "boss"}})
```

`cljs-rollbar` knows about [ExceptionInfo
instances](https://clojuredocs.org/clojure.core/ex-info), and will merge the
metadata map into the body of the request, so that in the above example `x` =>
`1` becomes a property of the event.


<img src="https://raw.githubusercontent.com/nervous-systems/cljs-rollbar/master/doc/exception.png" />

We may lean on Rollbar's Error rendering in less dramatic situations,
associating an `Error` with whatever severity we want:

```clojure
(promesa.core/then
  (report! {:debug (js/Error. "Oops")})
  println)
;; => {:err    0
;;     :result {:id nil, :uuid "dbd8081e330b4abf8c6f86586d26d863"}}
```

(The above example also includes Rollbar's API response)

# Library Integration

## Timbre

If you're using Timbre, it's straightforward to configure a cljs-rollbar appender.

```clojure
(timbre/merge-config!
  {:appenders {:rollbar (rollbar.timbre/appender report!)}})
;; (Where report! is the function we defined above
```

We can then proceed to log with Timbre as normal:

```clojure
(timbre/info "Hello" {:x 1})
```

Any map arguments passed to a Timbre logging call are merged into the map
supplied to the appender's reporting function --- and will become attributes of
the resulting Rollbar item. Additionally, line and file top-level attributes are
set based on the information received from Timbre, when not reporting an
error.

<div class="footnote"><small>line/file are ad-hoc attributes, because AFAICT,
there's no Rollbar slot for this information on non-Errors (the stacktrace
representation has line/file information, in that case).  Anyway, the
data's there.  </small></div>

```clojure
(timbre/error (js/Error. "Oops") {:version "0.2.0-final"})
(timbre/info {:env "dev"} "Stuff seems pretty good")
```

Assuming that your application's process doesn't terminate before the log
messages are transferred to Rollbar, you'll be flying.

## cljs-lambda

```clojure
(...
  (:require [cljs-lambda.util :refer [async-lambda-fn]]
            [cljs-rollbar.lambda]))

(def report! ...)

(def ^:export blow-up
  (async-lambda-fn
    (fn [event ctx]
      (throw (ex-info "Sorry" {::x 2})))
    {:error-handler
      (cljs-rollbar.lambda/reporting-errors report!)}))
```

This'll cause errors thrown inside blow-up (or asynchronously realized errors)
to be sent via our Rollbar-reporting function `report!`.

The Lambda function won't return to the caller until the error is acknowledged
by Rollbar. In the event of a successful Rollbar API response, the underlying
error will be passed through to the caller as if the error handler wasn't in
between.

There's a bunch of helpful information attached to the errors - the alias the
function was invoked under, the Cognito ID of the invoking user, if available,
etc.


*Contributions welcomed*.
