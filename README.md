# Bluesky Profile Labeller

Listens to the firehose and emits labels based on data inferred from a user's profile.

## Assumptions

You will need to have your account set up as a labeller, configured for whatever labels are valid. That user's details are assumed to be the same as the user running this service.

At some point, this will assume [Ozone](https://github.com/bluesky-social/ozone), since I want to act on some kinds of appeals, etc. and want the UI.

Expects the environment:

```shell
LABELLER_HANDLE=
LABELLER_PASSWORD=
NEON_DATABASE_URL=postgresql://...
NEWHANDLE_EXPIRY=2592000
```

You can also set `DANGEROUSLY_EXPOSE_SECRETS=true` to get debug output and block emitting, and configure alternative URLS with:

```shell
LABELLER_SERVICE=https://bsky.social
PUBLIC_SERVICE=https://public.api.bsky.app
PLC_DIRECTORY=https://plc.directory
```

/lib/limit.ts is full of tweakables depending on your particular needs - defaults should be fine, but this is where you can configure rate limits

(This part very subject to change - this is an in-flight project and I've done no work to package for release.)

## Target labels

### Currently implemented

| Label           | Description                                                        | Tag           |
| --------------- | ------------------------------------------------------------------ | ------------- |
| New Account     | A new account that has its first post <30 days ago                 | newaccount    |
| New Handle      | An account that has its first post under a new handle <30 days ago | newhandle     |
| No Avatar       | An account without a profile picture                               | noavatar      |
| No Display Name | An account without a display name                                  | nodisplayname |
| Non-PLC DID     | An account with a did that isn't did:plc:...                       | nonplcdid     |
| Periodic        | An account that has posted at very regular intervals for 100 posts | rapidposts    |

### TODO

- Pronouns/flags/etc.
  - Not totally sure here, but want to match on some items.
  - May support 'custom' attributes if present in profile
