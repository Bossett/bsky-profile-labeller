# Bluesky Profile Labeller

Listens to the firehose and emits labels based on data inferred from a user's profile.

## Assumptions

You will need to have your account set up as a labeller, configured for whatever labels are valid. That user's details are assumed to be the same as the user running this service.

At some point, this will assume [Ozone](https://github.com/bluesky-social/ozone), since I want to act on some kinds of appeals, etc. and want the UI.

Expects the environment:

```shell
LABELLER_HANDLE=
LABELLER_PASSWORD=
LABELLER_SERVICE=https://bsky.social
NEON_DATABASE_URL=postgresql://...
NEWHANDLE_EXPIRY=2592000
```

(This part very subject to change - this is an in-flight project and I've done no work to package for release.)

## Target labels

### Currently implemented

| Label       | Description                                                        | Tag        |
| ----------- | ------------------------------------------------------------------ | ---------- |
| New Account | A new account that has its first post <30 days ago                 | newaccount |
| New Handle  | An account that has its first post under a new handle <30 days ago | newhandle  |

### TODO

- New...
  - New pfp
- Incomplete
  - No pfp
  - No display name
- Pronouns/flags/etc.
  - Not totally sure here, but want to match on some items.
  - May support 'custom' attributes if present in profile
