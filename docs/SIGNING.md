# Release signing (#356)

Peers release APKs are signed with a **production keystore** you hold — never the debug key,
and never a key an agent generated. The gradle wiring reads the keystore + passwords from your
local `gradle.properties` (or env); nothing secret is committed.

## The key

An Android app's signing key is its **permanent update identity**: every future update MUST be
signed with the same key, or Android refuses the update. Pick deliberately and **back up the
`.p12` + passwords** — if lost, the app can never be updated (users must uninstall/reinstall).

You already custody a production keystore for the F-Droid repo:
`~/basecamp/fdroid/keystore.p12` (alias `xalisher`). Two options:

- **Reuse it** — sign Peers with the existing `xalisher` key. Simplest; but it mixes the
  repo-index key with the app key.
- **Dedicated alias (recommended)** — add a separate `peers-release` key to the same keystore,
  so the app key is distinct from the repo-index key:

  ```sh
  keytool -genkeypair -v \
    -keystore ~/basecamp/fdroid/keystore.p12 -storetype PKCS12 \
    -alias peers-release -keyalg RSA -keysize 4096 -validity 10000 \
    -dname "CN=Peers, OU=Peers, O=xAlisher"
  ```

## Configure (local `~/.gradle/gradle.properties` — gitignored, never committed)

```properties
RELEASE_STORE_FILE=/home/alisher/basecamp/fdroid/keystore.p12
RELEASE_STORE_PASSWORD=********
RELEASE_KEY_ALIAS=peers-release      # or: xalisher (to reuse the repo key)
RELEASE_KEY_PASSWORD=********
```

The keystore file and these passwords stay on your machine (the `.p12` is already gitignored in
`~/basecamp/fdroid`). Do **not** put them in the repo.

Each value may equivalently come from a **plain environment variable of the same name** (for a
release job that would rather export than write `gradle.properties`), or from `-P` flags:

```sh
RELEASE_STORE_FILE=$HOME/basecamp/fdroid/keystore.p12 \
RELEASE_STORE_PASSWORD=… RELEASE_KEY_ALIAS=peers-release RELEASE_KEY_PASSWORD=… \
  ./gradlew assembleRelease -x lint -PassertReleaseSigned
```

Project property wins over the environment; a blank value counts as **unset** (so an empty
`RELEASE_STORE_FILE=` can't half-configure the signing config or fool the guard).

## Build a signed release

```sh
cd android
JAVA_HOME=/usr/lib/jvm/java-1.17.0-openjdk-amd64 \
  ./gradlew assembleRelease -x lint -PassertReleaseSigned
```

- `-PassertReleaseSigned` makes the build **fail** rather than silently fall back to the debug
  key when `RELEASE_STORE_FILE` is unset — so a distributable release can never be debug-signed.
- Without any `RELEASE_*` props, a plain `assembleRelease` still works but is **debug-signed**
  (dev/CI only) and logs a warning.

## Verify the signer

```sh
$ANDROID_SDK_ROOT/build-tools/*/apksigner verify --print-certs \
  android/app/build/outputs/apk/release/app-release.apk
```

Confirm the certificate is your production key (not `CN=Android Debug`). Once the first release
is published with a given alias, keep using that same alias forever.

## `/release-peers`

The release skill should build with `-PassertReleaseSigned` and run the `apksigner verify` check
above before publishing, so an unsigned/debug artifact is caught before it reaches testers.
