# Apple signing and notarization

Use an Apple Developer Program membership to sign Buddylist's Mac app and submit it to Apple for notarization. A successful notarized build lets macOS verify the developer and the app's integrity when someone installs a download from the website.

One membership can cover multiple projects. The Developer ID Application certificate belongs to the developer's team and can sign multiple Mac apps. Each project still needs its own bundle identifier, build configuration, and access to the required CI credentials.

## Buddylist account and certificate

| Item                   | Value                               |
| ---------------------- | ----------------------------------- |
| Membership             | Apple Developer Program, Individual |
| Developer              | Tahsin Safa ELMALI                  |
| Team ID                | `53VPWYV23L`                        |
| Signing certificate    | Developer ID Application            |
| Certificate authority  | Developer ID G2                     |
| Certificate expiration | 17 September 2031                   |
| App bundle identifier  | `dev.buddylist.app`                 |
| Repository             | `SafaElmali/buddylist`              |

These identifiers are not passwords. Keep the certificate's private key, exported `.p12`, export password, and notarization password out of Git and out of this guide.

## 1. Enroll with Apple

1. Use an existing Apple Account with two-factor authentication enabled.
2. Start [Apple Developer Program enrollment](https://developer.apple.com/programs/enroll/) on the website or in the Apple Developer app.
3. Choose **Individual / Sole Proprietor** for a personal membership and enter your legal name and contact details.
4. Complete Apple's identity verification, review the agreement, and purchase the membership.
5. Check the final purchase sheet for the local price and renewal terms. Apple lists a US reference price, but regional checkout pricing can differ. Keep the receipt.
6. Open the [developer account](https://developer.apple.com/account/). A subscription receipt confirms payment; access may remain **Pending** while Apple finishes enrollment. Continue when **Membership details** and **Certificates, IDs & Profiles** are available.
7. Copy the **Team ID** from Membership details. The enrollment ID in the purchase flow is a different identifier.

The Apple Account password stays with Apple. GitHub uses an app-specific password for notarization.

## 2. Create the signing certificate

For a Mac app distributed as a DMG or ZIP outside the Mac App Store, choose **Developer ID Application**. A **Developer ID Installer** certificate is for signing `.pkg` installers.

### Using Xcode

1. In Xcode, open **Settings → Accounts**, add your Apple Account, and select the paid developer team.
2. Open **Manage Certificates → + → Developer ID Application**.
3. In **Keychain Access → My Certificates**, find the new Developer ID Application identity. Expand it and confirm the matching private key is present.
4. Export the identity as a password-protected `.p12` containing both the certificate and its private key.

### Using the Apple website

1. Generate a certificate signing request on your Mac. In Keychain Access, use **Certificate Assistant → Request a Certificate from a Certificate Authority**, enter your email and a recognizable name, and save the request to disk. Keep the generated private key.
2. Open [Certificates](https://developer.apple.com/account/resources/certificates/list), add a certificate, and choose **Developer ID Application**.
3. Select **G2 Sub-CA**, upload the `.certSigningRequest`, and continue.
4. Download the `.cer` and import it into the keychain containing the matching private key. Export the complete identity as a password-protected `.p12`.

If the request was generated with OpenSSL instead, combine the downloaded certificate with that same private key when creating the `.p12`. Importing the `.cer` alone does not recover a private key.

Keep a secure backup of the `.p12` and its password, preferably in a password manager or encrypted vault. Apple provides the public certificate again, but cannot give you the private key. GitHub secrets also cannot be read back through its settings or API.

See Apple's [certificate instructions](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/) and [certificate request instructions](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request/).

## 3. Create the notarization password

1. Sign in at [account.apple.com](https://account.apple.com/).
2. Open **Sign-In and Security → App-Specific Passwords**. In Turkish, these are **Giriş Yapma ve Güvenlik → Uygulamaya Özgü Parolalar**.
3. Generate a password labeled **Buddylist notarization** and complete Apple's authentication prompts.
4. Save the generated value directly as the GitHub secret described below. Do not put it in source code, screenshots, issues, or chat.

Changing the main Apple Account password revokes its app-specific passwords, so update CI if that happens. See [Apple's app-specific password guide](https://support.apple.com/en-us/102654).

## 4. Configure GitHub Actions

In [Buddylist's Actions settings](https://github.com/SafaElmali/buddylist/settings/secrets/actions), add these repository secrets:

| Secret                        | Value                                                   |
| ----------------------------- | ------------------------------------------------------- |
| `APPLE_ID`                    | The Apple Account email belonging to the developer team |
| `APPLE_APP_SPECIFIC_PASSWORD` | The generated notarization password                     |
| `MAC_CERTIFICATE_PASSWORD`    | The password protecting the exported `.p12`             |
| `MAC_CERTIFICATE`             | The `.p12` encoded as base64                            |

Under the **Variables** tab, add `APPLE_TEAM_ID` with the Team ID. This workflow reads it as a variable, not a secret.

To upload the certificate using GitHub CLI without displaying its contents:

```bash
base64 -i /path/to/developer-id.p12 | gh secret set MAC_CERTIFICATE --repo SafaElmali/buddylist
```

Add `MAC_CERTIFICATE` last. Its presence enables signing in the build workflow. Once enabled, a missing Apple ID, app-specific password, or Team ID fails the build. Without the certificate, build-only runs use ad-hoc signing. Releases require the certificate and its password.

The signing workflow must also be present on the branch being built. Adding secrets does not merge the PR or change the workflow on `main`.

## 5. Verify with a build-only run

1. Open **Actions → Build app → Run workflow**.
2. Select `main`, or the branch containing the signing changes you want to verify.
3. Set **mode** to **build**. The default is **release**, so select this explicitly.
4. Wait for both the tests and macOS packaging to finish.
5. In **Check installers**, confirm signature checks pass, Gatekeeper reports `source=Notarized Developer ID`, and the stapled ticket validates.
6. Confirm the bundled Claude executable still has Anthropic's signature. Buddylist's certificate must not replace it.

A build-only run does not publish a public release or create a release version. Its installer artifact is temporary and may be unavailable if GitHub artifact storage is full; the installer checks remain the validation result.

Once the signing changes are merged and a notarized release is published, update public installation instructions to match that actual release. Local ad-hoc builds still have different first-launch behavior.

For release operations, see [Releases and updates](releases.md).

## Use the membership for another project

1. Give the new app its own bundle identifier, for example `dev.example.newapp`.
2. Reuse this paid membership and Developer ID Application identity for another direct-download Mac app. A separate certificate per app is not required.
3. Configure that app's signing, hardened runtime, entitlements, and notarization. Copy only permissions the app actually needs.
4. Add the required credentials to its repository, or deliberately grant it access to organization-level secrets. Repository secrets are not inherited by another repository.
5. Generate a separately labeled app-specific password for the project, so its notarization credential can be revoked independently.
6. Run and verify a build-only test before publishing.

iOS and Mac App Store distribution use different certificate and provisioning requirements. This guide covers direct-download Mac applications.

## Maintenance and recovery

- **Membership renewal:** keep the membership active for continued access to signing and notarization services. Certificate expiration is separate from the annual subscription.
- **Expired or replaced certificate:** update `MAC_CERTIFICATE` and its matching password, then verify a build before publishing.
- **Lost private key:** downloading the `.cer` again is insufficient. Restore the `.p12` backup or create a new signing identity.
- **Notarization authentication failure:** check the Apple Account email, Team ID, and app-specific password. If the main Apple password changed, generate a new app-specific password.
- **CI keychain password failure:** electron-builder versions before 26.16.1 can pass the certificate export password to `security set-key-partition-list` instead of the temporary keychain password. Buddylist uses 26.17.0, which includes the [upstream fix](https://github.com/electron-userland/electron-builder/pull/10172). Update an older locked dependency before replacing working Apple credentials.
- **Apple form does not advance:** check the certificate list before retrying, so an uncertain response does not produce duplicate certificates. Reauthenticate if needed.
- **Shared certificate rotation:** coordinate updates across every project using that identity. Revoking a certificate is a separate action from replacing a repository secret.
