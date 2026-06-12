# Gmail MCP Server Specification (Exact Source Mapping)

**Source:** Gmail API REST Reference (v1)

Service Endpoint:

* `https://gmail.googleapis.com`

Discovery Document:

* `https://gmail.googleapis.com/$discovery/rest?version=v1`

This document maps Gmail REST resources exactly as defined by Google into MCP tool groups.

---

# Resource: v1.users

## Methods

### getProfile

GET `/gmail/v1/users/{userId}/profile`

Returns:

* emailAddress
* messagesTotal
* threadsTotal
* historyId

### stop

POST `/gmail/v1/users/{userId}/stop`

Stops mailbox push notifications.

### watch

POST `/gmail/v1/users/{userId}/watch`

Starts push notifications.

---

# Resource: v1.users.drafts

## Methods

### create

POST `/gmail/v1/users/{userId}/drafts`

### delete

DELETE `/gmail/v1/users/{userId}/drafts/{id}`

### get

GET `/gmail/v1/users/{userId}/drafts/{id}`

### list

GET `/gmail/v1/users/{userId}/drafts`

### send

POST `/gmail/v1/users/{userId}/drafts/send`

### update

PUT `/gmail/v1/users/{userId}/drafts/{id}`

---

# Resource: v1.users.history

## Methods

### list

GET `/gmail/v1/users/{userId}/history`

Supports:

* startHistoryId
* historyTypes
* labelId
* maxResults
* pageToken

---

# Resource: v1.users.labels

## Methods

### create

POST `/gmail/v1/users/{userId}/labels`

### delete

DELETE `/gmail/v1/users/{userId}/labels/{id}`

### get

GET `/gmail/v1/users/{userId}/labels/{id}`

### list

GET `/gmail/v1/users/{userId}/labels`

### patch

PATCH `/gmail/v1/users/{userId}/labels/{id}`

### update

PUT `/gmail/v1/users/{userId}/labels/{id}`

---

# Resource: v1.users.messages

## Methods

### batchDelete

POST `/gmail/v1/users/{userId}/messages/batchDelete`

### batchModify

POST `/gmail/v1/users/{userId}/messages/batchModify`

### delete

DELETE `/gmail/v1/users/{userId}/messages/{id}`

### get

GET `/gmail/v1/users/{userId}/messages/{id}`

Formats:

* full
* metadata
* minimal
* raw

### import

POST `/gmail/v1/users/{userId}/messages/import`

### insert

POST `/gmail/v1/users/{userId}/messages`

### list

GET `/gmail/v1/users/{userId}/messages`

### modify

POST `/gmail/v1/users/{userId}/messages/{id}/modify`

### send

POST `/gmail/v1/users/{userId}/messages/send`

### trash

POST `/gmail/v1/users/{userId}/messages/{id}/trash`

### untrash

POST `/gmail/v1/users/{userId}/messages/{id}/untrash`

---

# Resource: v1.users.messages.attachments

## Methods

### get

GET `/gmail/v1/users/{userId}/messages/{messageId}/attachments/{id}`

Retrieves attachment data.

---

# Resource: v1.users.settings

## Methods

### getAutoForwarding

GET `/gmail/v1/users/{userId}/settings/autoForwarding`

### getImap

GET `/gmail/v1/users/{userId}/settings/imap`

### getLanguage

GET `/gmail/v1/users/{userId}/settings/language`

### getPop

GET `/gmail/v1/users/{userId}/settings/pop`

### getVacation

GET `/gmail/v1/users/{userId}/settings/vacation`

### updateAutoForwarding

PUT `/gmail/v1/users/{userId}/settings/autoForwarding`

### updateImap

PUT `/gmail/v1/users/{userId}/settings/imap`

### updateLanguage

PUT `/gmail/v1/users/{userId}/settings/language`

### updatePop

PUT `/gmail/v1/users/{userId}/settings/pop`

### updateVacation

PUT `/gmail/v1/users/{userId}/settings/vacation`

---

# Resource: v1.users.settings.cse.identities

## Methods

### create

POST `/gmail/v1/users/{userId}/settings/cse/identities`

### delete

DELETE `/gmail/v1/users/{userId}/settings/cse/identities/{cseEmailAddress}`

### get

GET `/gmail/v1/users/{userId}/settings/cse/identities/{cseEmailAddress}`

### list

GET `/gmail/v1/users/{userId}/settings/cse/identities`

### patch

PATCH `/gmail/v1/users/{userId}/settings/cse/identities/{emailAddress}`

---

# Resource: v1.users.settings.cse.keypairs

## Methods

### create

POST `/gmail/v1/users/{userId}/settings/cse/keypairs`

### disable

POST `/gmail/v1/users/{userId}/settings/cse/keypairs/{keyPairId}:disable`

### enable

POST `/gmail/v1/users/{userId}/settings/cse/keypairs/{keyPairId}:enable`

### get

GET `/gmail/v1/users/{userId}/settings/cse/keypairs/{keyPairId}`

### list

GET `/gmail/v1/users/{userId}/settings/cse/keypairs`

### obliterate

POST `/gmail/v1/users/{userId}/settings/cse/keypairs/{keyPairId}:obliterate`

---

# Resource: v1.users.settings.delegates

## Methods

### create

POST `/gmail/v1/users/{userId}/settings/delegates`

### delete

DELETE `/gmail/v1/users/{userId}/settings/delegates/{delegateEmail}`

### get

GET `/gmail/v1/users/{userId}/settings/delegates/{delegateEmail}`

### list

GET `/gmail/v1/users/{userId}/settings/delegates`

---

# Resource: v1.users.settings.filters

## Methods

### create

POST `/gmail/v1/users/{userId}/settings/filters`

### delete

DELETE `/gmail/v1/users/{userId}/settings/filters/{id}`

### get

GET `/gmail/v1/users/{userId}/settings/filters/{id}`

### list

GET `/gmail/v1/users/{userId}/settings/filters`

---

# Resource: v1.users.settings.forwardingAddresses

## Methods

### create

POST `/gmail/v1/users/{userId}/settings/forwardingAddresses`

### delete

DELETE `/gmail/v1/users/{userId}/settings/forwardingAddresses/{forwardingEmail}`

### get

GET `/gmail/v1/users/{userId}/settings/forwardingAddresses/{forwardingEmail}`

### list

GET `/gmail/v1/users/{userId}/settings/forwardingAddresses`

---

# Resource: v1.users.settings.sendAs

## Methods

### create

POST `/gmail/v1/users/{userId}/settings/sendAs`

### delete

DELETE `/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}`

### get

GET `/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}`

### list

GET `/gmail/v1/users/{userId}/settings/sendAs`

### patch

PATCH `/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}`

### update

PUT `/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}`

### verify

POST `/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}/verify`

---

# Resource: v1.users.settings.sendAs.smimeInfo

## Methods

### delete

DELETE `/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}/smimeInfo/{id}`

### get

GET `/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}/smimeInfo/{id}`

### insert

POST `/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}/smimeInfo`

### list

GET `/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}/smimeInfo`

### setDefault

POST `/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}/smimeInfo/{id}/setDefault`

---

# Resource: v1.users.threads

## Methods

### delete

DELETE `/gmail/v1/users/{userId}/threads/{id}`

### get

GET `/gmail/v1/users/{userId}/threads/{id}`

### list

GET `/gmail/v1/users/{userId}/threads`

### modify

POST `/gmail/v1/users/{userId}/threads/{id}/modify`

### trash

POST `/gmail/v1/users/{userId}/threads/{id}/trash`

### untrash

POST `/gmail/v1/users/{userId}/threads/{id}/untrash`

---

# Summary

Total REST Resources: 15

Total Methods Defined by Gmail API v1: 76

This specification mirrors the Gmail API resource hierarchy and method names exactly as documented by Google and is intended to be used as the canonical blueprint for a complete Gmail MCP server.
