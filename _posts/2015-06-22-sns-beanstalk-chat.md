---
layout: post
title: Pushing Events Over Websockets with SNS & Elastic Beanstalk
summary: Backing vocals by Docker & core.async.
date:       2015-06-22 01:35:29
author: Moe Aboulkheir
categories: clojure async sns eb docker
tags: clojure async sns eb docker
---

## Introduction

There's a lot to cover, and my reserves of pomposity are dwindling
- let's forego our tradition of the [expansive, AI-baiting
introduction](/clojure/iris/messaging/2015/06/03/iris-clojure-part-one/), and
get into it.

We're going to use Clojure to build a simple, ephemeral and anonymous chat
application, which'll somehow transmit messages between web browsers via
Amazon's push notification service, SNS.

<div class="footnote">
N.B. <small>
Not that it's necessarily a good idea to build chat applications on top of SNS, only that
 chat is a convenient means of generating events.
</small>
</div>

Targeting [Elastic
Beanstalk](http://docs.aws.amazon.com/elasticbeanstalk/latest/dg/Welcome.html)
via [Docker](https://www.docker.com/), we'll make it easy for our application's
resources to be scaled upwards in response to user demand.

## Demo

<iframe src="https://nervous.io/static/sns-beanstalk-chat" width="300" height="100"></iframe>
<iframe src="https://nervous.io/static/sns-beanstalk-chat" width="300" height="100"></iframe>

Each iframe shows the four most recent messages delivered after page render
time.  There will be delays/discrepant orderings, due to notifications reaching
subscribed endpoints at different times.

Aside from communicating with yourself, you're communicating with anyone else
unfortunate enough to be reading this article.

## Platform

Mostly we're treating Elastic Beanstalk as a black box, accepting a Docker image
and returning a load balancer, behind which it will place a dynamically-sized
pool of instances running our image.

As for Docker, for our purposes it's a black box which takes a small file and
turns it into a giant one, allowing us to ignore all of the details of operating
systems which aren't relevant to our application.

## Approach

We're aiming for a single Clojure process which'll perform small amount of
bookkeeping at startup, before exposing two HTTP endpoints via
[httpkit](http://www.http-kit.org/):

 - `POST /topic/events` (SNS-facing)
 - `GET /topic/events` (user-facing, accepts websocket connections only)

### SNS

At launch time, each instance of our process will subscribe its own `/topic/events`
endpoint to notifications from SNS, on some pre-agreed topic.  Each time we
receive a `POST` from SNS, we'll place its contents on an asynchronous
[channel](https://github.com/clojure/core.async) in memory.

### Users

Incoming websocket clients will be fed messages as they're received from SNS and
 placed on the incoming channel.  We'll also accept messages from users,
 publishing them to the application's topic via the SNS API.

### Load

The pushes from SNS will be addressed to all nodes individually, whereas the
requests from users will be handed off by the [Elastic Load
Balancer](http://aws.amazon.com/elasticloadbalancing/) created by Beanstalk: all
nodes receive all messages, and share the work of distributing them to end
users.

## Code

The code is available as [sns-beanstalk-chat on
Github](https://github.com/nervous-systems/sns-beanstalk-chat), though we'll be
going through it in detail below.

### Deployment

The project uses a Leiningen plugin called
[uberimage](https://github.com/palletops/lein-uberimage), which builds an
uberjar and generates a Docker image which'll run its entrypoint.

As we're not doing anything too compromising, the built Docker image can be
pushed publicly to [Docker Hub](https://hub.docker.com/), from where Elastic
Beanstalk can be instructed to retrieve it.  An example
[Dockerrun.aws.json](http://docs.aws.amazon.com/elasticbeanstalk/latest/dg/create_deploy_docker_image.html) (urgh)
file is [included in the
repository](https://github.com/nervous-systems/sns-beanstalk-chat/blob/master/Dockerrun.aws.json), which does just that - specify the image, and request a port be mapped.

```sh
$ lein uberimage
$ docker push nervoussystems/sns-web-chat
```

The static portions of our application (the HTML/JS from the above demo) are
just hanging out in an S3 bucket, far away from all of this - Elastic Beanstalk
is _only_ hosting the two dynamic endpoints.

### On Startup

(All excerpts below are from
[handler.clj](https://github.com/nervous-systems/sns-beanstalk-chat/blob/master/src/sns_beanstalk_chat/handler.clj))

We'll be using [Fink-Nottle](https://github.com/nervous-systems/fink-nottle) to
talk to SNS ([covered in detail last
week](/clojure/aws/async/sns/messaging/2015/06/15/fink-nottle-sns)), as well as
leaning on some instance metadata-retrieval functionality from
[Eulalie](https://github.com/nervous-systems/eulalie), the underlying AWS
communication library.

While all of the HTTP endpoints and post-startup I/O are asynchronous (one bang `!`),
most of the initialization code is blocking (double-bang `!!`).

#### Retrieving IAM Credentials

We don't want to have to pass root-level credentials into our application.  When
setting up our Beanstalk environment, we asked that an IAM role - having suitable
permissions for accessing SNS - be associated with its instances.

There is a wacky, within-EC2 API for retrieving that kind of stuff over HTTP,
which is exposed in Eulalie:

```clojure
(ns sns-beanstalk-chat.handler
  (:require [eulalie.instance-data :as instance-data]
            [eulalie.creds :as creds]))

(defn get-creds!! []
  (let [iam-role (instance-data/default-iam-role!!)
        current  (atom (instance-data/iam-credentials!! iam-role))]
    (creds/periodically-refresh! current iam-role)
    {:eulalie/type :refresh :current current}))
```

A typical credentials map would be `{:access-key ... :secret-key ...}`, however
our IAM credentials (`:token`, `:expiration`) are time-delimited, and we don't
really want the rest of our application to have to care about that.

We start an asynchronous process (`periodically-refresh!`), which will quietly
re-retrieve the credentials prior to expiry, and update our atom.  Internally,
Eulalie and Fink-Nottle will deref the atom whenever an AWS request is made.

#### Subscription

Before we dive into the web stuff, let's look at the SNS subscription step,
 which, by necessity, happens _after_ the HTTP server is started (when we
 subscribe our endpoint, SNS will immediately ask it for confirmation - we ought
 to be listening).

 First, we create a couple of core.async channels we'll share
 with the HTTP handlers, and retrieve some more instance metadata:

```clojure
(let [topic        :sns-demo-events
      creds        (get-creds!!)
      sns-incoming (async/chan)
      sns-outgoing (async/chan)
      region       (instance-data/identity-key!! :region)
      hostname     (instance-data/meta-data!! :public-hostname)]

  ;; HTTP server initialization goes here

  (let [{:keys [topic-arn]}
        (subscribe-sns!! creds hostname topic)]
    (sns-publish! creds topic-arn sns-outgoing))
```

We're subscribing to a named SNS topic, and then starting a long-running,
asynchronous process (`sns-publish!`) which will read messages from
`sns-outgoing`, and send them out into the world:

```clojure
(ns ...
 (:require [fink-nottle.sns :as sns]
           ...))

(defn subscribe-sns!! [creds this-address topic-name]
  (let [topic-arn  (sns/create-topic!! creds topic-name)
        endpoint   (str "http://" this-address "/topic/events")]
    {:topic-arn topic-arn
     :subscription-arn
     (sns/subscribe!! creds topic-arn :http endpoint)}))

(defn sns-publish! [creds topic-arn msg-chan]
  (async/go-loop []
    (when-let [message (<! msg-chan)]
      (<! (sns/publish-topic! creds topic-arn message))
      (recur))))
```

Note that the `create-topic` will have no effect if the topic already exists,
other than retrieving its identifier.

### HTTP Handlers

```clojure
(ns ...
  (:require [compojure.core :as cj]
            [org.httpkit.server :as http]
            ...))

(defn make-app [config state]
  (cj/routes
   (cj/POST "/topic/events" [] (make-post-handler config state))
   (cj/GET  "/topic/events" [] (make-get-handler  config state))))

(defn -main []
  ;; Redacted: initialization from previous section
  (http/run-server
   (make-app
    {:topic topic :region region}
    {:creds creds
     :sns-incoming-mult (async/mult sns-incoming)
     :sns-incoming sns-incoming
     :sns-outgoing sns-outgoing})
   {:port 8080}))
```

<div class="footnote">
N.B. <small>
One confusing detail is that we're binding to 8080 here, but above did not specify any such port in the subscription URL we gave to SNS - in its "web" configuration, Beanstalk maps 80 to whatever port we indicate in
our Dockerrun file: this is 8080 <i>inside the Docker container</i>.
</small>
</div>



We're trying to make our handler dependencies as explicit as possible - rather
than stashing them in requests, or trying to define the handler bodies
within `make-app`, we're closing over the bits of the config and state we
require:

#### POST Handler

```clojure
(ns ...
  (:require [fink-nottle.sns.consume :as sns.consume]
            [org.httpkit.client :as http.client]
            ...))

(defn make-post-handler [{region :region} {chan :sns-incoming}]
  (fn [{:keys [body] :as req}]
    (go
      (let [{:keys [type] :as m}
            (sns.consume/stream->message body)]
        (when (<! (sns.consume/verify-message! m region))
          (case type
            :subscription-confirmation
            (http.client/get (:subscribe-url m))
            :notification (async/put! chan (:message m))))))
    nil))
```

We receive messages from SNS, and respond immediately with an empty body.  In
one case, we visit the subscription confirmation URL (recall above, the
invocation of `subscribe-sns!!`, which'll trigger a confirmation request),
otherwise we put the string message body on the `sns-incoming` channel.

<div class="infobox">
<div class="infobox-title">Backpressure</div>
<p>
Naively exerting backpressure in the above handler (i.e. delaying our [empty] response until our <code>put!</code> is accepted) wouldn't be meaningful from the perspective of SNS - it's going to send us messages as fast as it can.
<br></br>
Under different circumstances, we could use the HTTP response code to signal inability to accept a message, combining this with a custom <a href="http://docs.aws.amazon.com/sns/latest/dg/DeliveryPolicies.html">retry policy</a> to similar overall effect.  We're also free to set a maximum delivery rate, either per topic, or per subscription, with messages in excess being subject to the retry policy.
<br></br>
</p>
</div>

#### Websocket Handler

The final function:

```clojure
(defn make-get-handler
  [_ {mult :sns-incoming-mult out-chan :sns-outgoing}]
  (fn [req]
    (let [to-client (async/chan)]
      (async/tap mult to-client)
      (http/with-channel req handle
        (http/on-receive
         handle
         (fn [message]
           (let [[tag body] (json/decode message)]
             (if (= tag "message")
               (async/put! out-chan body)))))
        (async/go-loop []
          (when-let [value (<! to-client)]
            (if (http/send! handle value)
              (recur)
              (async/close! to-client))))))))
```

We're using a _multiple_ of the `sns-incoming` channel to get multicast
behaviour - a write to `sns-incoming` (by the POST handler, above) will be
translated into a write on each _tap_ of the mult.  Each time a client connects,
we create a tap channel and siphon its contents into the websocket.

Our `on-receive` callback place messages from the client onto the channel being
consumed by `sns-publish!`.

## Compromises

### Unsubscribe

You'll notice that there isn't any code to try and unsubscribe nodes which have
been removed from circulation.  The only practical downside of failing to do
this seems to be that (depending on volume) you may be paying for failed delivery
attempts.

A fairly simple approach would be to have all nodes subscribe to an SQS queue
which receives autoscale notifications, with a view to locating and removing the
subscriptions of outgoing peers.  Maybe this'll be covered in a follow-up post.

### Exposing The SNS-Facing Endpoint

It would seem natural to bind the `POST` endpoint to the instance's internal/EC2
interface, and use that address when subscribing with SNS - however, SNS rejects
internal endpoint subscriptions, citing a permission error, regardless of the
topic permissions.

It's also impractical to exclude requests to the message notification endpoint
based on source address, as there's a long and occasionally-changing list of
potential sources.

Keeping the endpoint public, while verifying message signatures, seems like the
healthiest approach.

<div class="footnote">
N.B. <small>
To do this with Elastic Beanstalk, we'll need to edit the security group that the launched instances belong to, such that they'll accept inbound requests on port 80 from anywhere.
</small>
</div>


### ELB/Heartbeating

The websocket handler ignores all input which isn't tagged as "message"
(i.e. `["message" "body"]`) - this is to allow the client to make noise as a
means of keeping the connection alive.

In HTTP mode, Elastic Load Balancer doesn't work with websockets at all - this
demo application requires the Beanstalk load balancer be running in TCP mode.

That said, in TCP mode, an idle timeout still applies, and its value can't be
changed via Elastic Beanstalk's LB configuration - the generated load balancer
must be adjusted directly.

