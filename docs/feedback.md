# Feedback, bugs and requests

One form, in three places:

- **In the app**: **Help → Send feedback...** in the contact list, a conversation and the message history.
- **On the landing page**: the **Feedback** section, above the footer.
- **In the browser demo**: the same Help menu. A report sent there is as real as one from the app.

A report says what it is (feedback, a bug report or a feature request) and has a message. An email address, a screenshot and a line about the system are optional:

- **The email address** is only there to answer to.
- **The screenshot** is one PNG, JPEG or WebP picture of up to 5 MB. In the app, **Browse...** picks a file, and pasting a picture into the form attaches what is on the clipboard.
- **The system** is `buddylist 0.2.3, macOS 15.1, arm64` from the app, and the browser's name from the page. The app shows the line under its checkbox, and unticking the box leaves it out.

## Where a report goes

Every form posts to `POST /api/feedback` on the landing page's Worker, [`site/worker.js`](../site/worker.js). The page and the demo post to their own address. The app posts to `FEEDBACK_URL` in [`src/shared/feedback.js`](../src/shared/feedback.js) from the main process, because a window may not reach the network.

The rules are in that one file too: the kinds of report, the limits, and the sentence a form shows for each rule a report breaks. The app checks a report before sending it, the Worker checks it again, and the build writes the limits into the page.

The Worker keeps reports in the `FEEDBACK` Workers KV namespace:

| Key                             | Value                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `feedback:<when>-<id>`          | the report as JSON: `kind`, `message`, `email`, `system`, `from`, `sentAt`, `screenshot` |
| `screenshot:<when>-<id>.<type>` | the picture, when one came with it                                                       |

A report's `from` is the form that sent it: `app`, `demo` or `page`. Its `screenshot` is the key of its picture, or `null`.

The endpoint turns down a post from any other website and leaves out a bot that fills in the hidden field. It also turns down a report that doesn't say which form sent it. Each form's script adds `from` and no form holds the field, so a bot that posts the page's form as it finds it is turned down, and so is the page without JavaScript. The app adds `from` since 0.2.34. A report from an older one has no page address and Node's `user-agent: node`, and the Worker takes that as `app` until no one runs one. One sender may post each form 5 times a minute: the `FORM_LIMIT` rate limit in [`wrangler.jsonc`](../wrangler.jsonc) counts each form and IP address apart, in each Cloudflare location. Past that, the Worker answers 429 and the form says to wait a minute.

## Reading them

```bash
npm run feedback
```

This lists the reports, oldest first. Each line has the key, what kind of report it is, the start of the message and whether a screenshot came with it. To read one in full, and to save its picture:

```bash
npx --yes wrangler@4 kv key get --binding FEEDBACK --remote "feedback:<when>-<id>"
npx --yes wrangler@4 kv key get --binding FEEDBACK --remote "screenshot:<when>-<id>.png" > screenshot.png
```

Nothing announces a new report: the list is the inbox.

## Trying it on this computer

```bash
npx --yes wrangler@4 dev --port 8787
```

This serves the page, the demo and the Worker with a store of its own, so nothing reaches the real one. To send from the app to it:

```bash
BUDDYLIST_FEEDBACK_URL=http://localhost:8787/api/feedback npm start
```

Read what arrived with `--local` in place of `--remote`.
