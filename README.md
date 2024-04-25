# Bluesky Profile Labeller

Listens to the firehose and emits labels based on data inferred from a user's profile.

## TODO

1.  set up connection to atproto (auth, etc.)
2.  actually emit events
3.  read profiles (batched? check rate limit) for blanks

## target labels

- New (counts from first post after event)
  - New: new account, first 30 days
  - New handle: handle changed in last 30 days
  - New pfp
- Incomplete
  - No pfp
  - No display name
- Pronouns/flags/etc.
  - Not totally sure here, but want to match on some items.
  - May support 'custom' attributes if present in profile
