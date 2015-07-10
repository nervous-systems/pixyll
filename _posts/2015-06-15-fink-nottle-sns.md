---
layout: post
title: Push Messaging on EC2 with core.async
summary: Sending GCM & APNS messages with a unified API, using Clojure, SNS & core.async.
date:   2015-06-15 15:28:29
author: Moe Aboulkheir
categories: clojure
tags: clojure aws async sns messaging
---

## Background

In the previous article on [using Clojure with
SQS](/clojure/aws/async/sqs/messaging/2015/06/15/fink-nottle-sqs/), we alluded
to the mass of mobile processors preening for absorption into our sprawling
reticulum.

No self-respecting superintelligence would forego such explosive opportunity.
At the same time, it seems an undignified task.  The General can't be seen
carousing with the footsoldiers, and so on.

Abstraction - and its lesser, euphemism - will preserve our vanity.

## Software

### [SNS](http://aws.amazon.com/sns/)

SNS is an Amazon service for transient push notifications.  It can send messages
to Android and IOS mobile devices via
[GCM](https://developers.google.com/cloud-messaging/) &
[APNS](https://developer.apple.com/library/ios/documentation/NetworkingInternet/Conceptual/RemoteNotificationsPG/Chapters/ApplePushService.html),
as well as over SMS, email,
[Lambda](http://aws.amazon.com/documentation/lambda/), etc.  It supports
multicast messages, and can push to SQS.

### [Fink-Nottle](https://github.com/nervous-systems/fink-nottle)

As before, Fink-Nottle is a Clojure library which tries to expose all of the
features of SNS & [SQS](http://aws.amazon.com/sqs/) via a consistent,
asynchronous API.  It's built on top of
[Eulalie](https://github.com/nervous-systems/eulalie), an
[httpkit](http://www.http-kit.org/)-based AWS client library.

## Examples

All of the functions we'll be talking about accept (at least) an AWS credentials
map (`:secret-key`, `:access-key`, optionally `:region`, `:token`), which we're
calling `creds`.  The single-bang `!` functions return asynchronous channels to
which one or more result values will be written, while the double-banged `!!`
ones will block awaiting a single value.  Both versions exist for all functions
discussed.

### GCM+APNS

We're going to set things up so we can send the same message to both Android and
IOS users, via GCM & APNS, using a unified API.

In SNS terminology, for each distinct messaging platform API key we'd like to
send messages under, we're to create an SNS _platform application_.  For APNS,
it'd look like this:

```clojure
(ns fink-nottle-demo.sns
  (:require [fink-nottle.sns :as sns]))

(def apns-app-arn
 (sns/create-platform-application!!
  creds :APNS "fink-nottle-apns"
  {:platform-credential apns-private-key
   :platform-principal  apns-certificate}))
```

We're doing this configuration portion synchronously (`!!`) for the
purposes of demonstration.  Let's beat up on GCM:

```clojure
(def gcm-app-arn
 (sns/create-platform-application!!
  creds :GCM "fink-nottle-gcm"
  {:platform-credential gcm-api-key}))
```

An ARN is an _Amazon Resource Name_ - a colon delimited string, which we're
treating as opaque.  The above two calls are pieces of setup we'd typically
perform once, storing the result values in something like a configuration
file.

For each user device we're interested in addressing via the above applications,
we create a _platform endpoint_, which associates a device-identifying token
with a platform application.  They're _endpoints_ because they're the
entities we will be asking SNS to send messages to:

```clojure
;; The token/ID below will have been received from the devices

(def test-apns-device-arn
  (sns/create-platform-endpoint!!
   creds apns-app-arn apns-device-token))

(def test-gcm-device-arn
  (sns/create-platform-endpoint!!
   creds gcm-app-arn gcm-registration-id))
```

Intoxicated by this sudden accumulation of meaningful-looking strings, we find
the courage to speak:

```clojure
;; Get a sequence of channels being processed in parallel
(for [endpoint-arn [test-apns-device-arn
                    test-gcm-device-arn]]
  (sns/publish-endpoint!
   creds endpoint
   {:GCM  {:data {:message "Hello!"}}
    :APNS {:aps  {:alert "Hello"}}}))
```

Both of the devices should make a noise shortly afterward.

When publishing, we can provide payloads for whatever services we anticipate
might be on the other side of the endpoint - we don't need to know too much
about the the endpoint itself.

The data below each service keyword (e.g. `{:aps {:alert ...}}`) are entirely
specific to those platforms - both happen to require maps.  We could just as
well add `:email "Hello"`, if we'd created an endpoint connected to an email
address.

### Using Topics For Mobile Broadcast

If our application issues data likely to be relevant to groups of users, it's
going to get tedious iterating over sequences of endpoint identifiers.  SNS
allows us to create a topic endpoint, and subscribe multiple platform
endpoints (abstracted devices) to them.

```clojure
(go
  (let [topic-arn (<! (sns/create-topic! creds "devices-upstate"))
        subscribe-chans
        (for [arn [test-apns-device-arn
                   test-gcm-device-arn
                   ...]]
          (sns/subscribe! creds topic-arn :application arn))]
    ;; Wait until we're all done
    (<! (->> subscribe-chans async/merge (async/into [])))
    (<! (sns/publish-topic!
         creds topic-arn {:APNS ... :GCM ...}))))
```

This is about as far away from the individual devices as we can hope to get.  As
long as we maintain our subscriptions (`unsubscribe!`,
`list-subscriptions-by-topic!`, etc), we can wave in the direction of
"devices-upstate" and get all up in the notification center.

Note that we can subscribe any kind of endpoint we want to the topic - SQS,
email, etc.  We just need to add either a `:default` entry in the map we
publish, or values for each of the subscribed platforms.

### Sending Messages to SQS

This is pretty neat, however it requires that we add alter the permissions of
the target SQS queue.  Amazon have instructions for [doing this
interactively](http://docs.aws.amazon.com/sns/latest/dg/SendMessageToSQS.html),
however it's also possible to express this fairly naturally using Fink-Nottle.

Long story short:

```clojure
(fink-nottle.sqs/set-queue-attribute!
 creds queue-url :policy
 {:statement
  [{:sid "fink-nottle-sqs-sns-bridge",
    :effect :allow
    :principal {:AWS "*"}
    :action [:sqs/send-message],
    :resource queue-url,
    :condition {:arn-equals {:aws/source-arn topic-arn}}}]})
```

Where the topic ARN identifies the SNS topic we're going to be using to push to
the queue.  Note that above we're setting the policy, not appending a statement
to it - if you have custom permissions for the given queue, they'll be
overwritten. The representation above round-trips - it's not going to get any
easier than this if you want to manually merge the permissions in.

Actually performing the subscription is pretty easy, we just need the ARN for
the queue (`sqs/queue-arn!`):

```clojure
(sns/subscribe! creds topic-arn :sqs queue-arn)
```

The final caveat is that by default, SNS delivers the message to your queue
embedded in a JSON document, with no attributes or markers outside of the body
to indicate that this may not be in a format you're familiar with.  We can use
the subscription ARN from the previous call to indicate that we don't want this:

```clojure
(sns/set-subscription-attribute!
 creds subscription-arn :raw-message-delivery true)
```

Now, for the message:

```clojure
(go
  (<! (sns/publish-topic! creds topic-arn {:default "Hello"}))
  (let [messages (sqs.channeled/receive! creds queue-url)]
    (assert (= "Hello"
               (async/alt!
                 messages ([{:keys [body]}] body)
                 (async/timeout 500) ::timeout)))))
```

## Conclusion

There are plenty of features we didn't get to cover - pushing to
[Lambda](http://aws.amazon.com/documentation/lambda/), sending SMS and email
notifications, etc. - however the shape will be very similar to the patterns
covered above.
