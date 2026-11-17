# Waves: Product Hunt launch kit

Status: draft for owner review. Written 2026-11-17. Facts come from `website/src/i18n/dictionaries/en.json`, the marketing docs and `website/src/content/competitors.ts`. Anything we do not own is a `TODO:`. Character counts are in brackets and were checked by script.

Tone note: "WhatsApp for finance" is our internal motto. The sales playbook says not to use it with prospects (it can imply a WhatsApp integration), so it is not used in any copy below.

---

## 1. Name and taglines (limit 60)

**Name:** Waves

| #        | Tagline                                               | Chars |
| -------- | ----------------------------------------------------- | ----- |
| A (pick) | Split bills, track money, run your team. Just say it. | 53/60 |
| B        | Expenses with friends and teams, even with no signal  | 52/60 |
| C        | The simple way to split, settle and keep the books    | 50/60 |

## 2. Description (limit 500)

> Waves is a free, open-source expense app for friends, your own money and small teams. Say "Dinner 1,200 split with Ravi and Priya" in English, Hindi, Tamil or Arabic and confirm the card. Works offline, settles via your UPI app, has an Apple Watch app and home-screen widgets, and connects to AI assistants over MCP. Free with no card; Pro is Rs 79/month or Rs 699/year.

370/500 chars

## 3. Topics

1. Fintech
2. Productivity
3. Android
4. iPhone
5. Open Source (swap in if PH only allows 3 and the owner prefers it over iPhone)

## 4. Maker's first comment (~250 words)

> Hi Product Hunt, I'm Madan, the maker of Waves.
>
> I built Waves because splitting money with people is awkward in a way the maths never is. A trip, a flat, a team: someone keeps a spreadsheet, someone else forgets, and a small amount ends up between friends. I wanted adding an expense to be as easy as sending a message.
>
> So you can just say it. Hold the mic and say "Dinner 1,200 split with Ravi and Priya", or "Ravi ne 300 diye chai ke liye". Waves works out the amount, who paid and who it is split with, then shows a card. You confirm before anything is saved. It understands English, Hindi, Tamil and Arabic, and you can mix them.
>
> A few things we cared about:
>
> - Offline first. Every expense is saved on your phone first and syncs when you are back online.
> - Waves never moves money. It works out who pays whom and opens your UPI app (or whatever you use) with the amount.
> - It also does your own money (budgets, loans, bank messages) and small-team expenses (claims, advances, wages).
> - You can ask an AI assistant to keep the books, over MCP.
> - It is open source, and the code is on GitHub.
>
> What is free: unlimited people, expenses, currencies, splits and settling up, with no card at sign-up. Free shows some ads. Pro (Rs 79/month or Rs 699/year in India, local store prices elsewhere) removes ads and adds more AI voice and receipt scans. New accounts get 15 days of Pro.
>
> One ask: tell us the first thing that confused you, or the thing you expected and did not find. I will read every comment today.

(Word count about 280. TODO: owner to confirm "Madan" and first-person details before posting.)

## 5. Gallery plan (1270x760 each)

Videos are existing loops at `https://assets.wavs.co.in/videos/<name>.mp4` (posters `<name>.jpg`, source in `infra/art/videos/`). PH accepts a YouTube link as the first slot or images; export the MP4s as 1270x760 stills or short GIF/MP4 clips. Headline goes on the image in large type, one line.

| Slot | Headline on image                   | Asset                                                      | Notes                                                                               |
| ---- | ----------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1    | Say it. Waves adds it.              | `personal-voice` (alt: `home-offline-voice`)               | Voice card with confirm.                                                            |
| 2    | Split a trip, settle on UPI         | `home-offline-sync` plus a screenshot of the settle screen | Example: Goa Trip, 9 bills, 2 transfers.                                            |
| 3    | No signal? Keep splitting.          | `home-offline-sync`                                        | "Saved first, synced later".                                                        |
| 4    | On your wrist and home screen       | `home-wearables`                                           | Apple Watch, iPhone and Android widgets. Say Wear OS is coming soon, not available. |
| 5    | Ask your AI. Waves keeps the books. | `home-agents`                                              | MCP, never moves money.                                                             |
| 6    | Your own money, just for you        | `personal-hero`                                            | Budgets, loans, bank messages.                                                      |
| 7    | Run your team like a chat           | `companies-team`                                           | Android and web only. iPhone coming soon.                                           |
| 8    | Free to start. Open source.         | Pricing screenshot from wavs.co.in                         | Free, no card; Pro Rs 79/month or Rs 699/year.                                      |

**Thumbnail (240x240 GIF):** the Waves logo on a calm background; a mic pulse, then a card pops up reading "Dinner Rs 1,200 / 3 people Rs 400 each", then loops. Under 3 MB, 2 to 3 seconds.

TODO: a 30 to 60 second launch video for slot 1 (YouTube). Nothing exists yet; `docs/marketing/screenplays.md` has candidate scripts.

## 6. Launch-day plan

### Timing

- PH day starts 12:01am Pacific. In November to March (PST, UTC-8) that is **1:31pm IST**. From March to November (PDT, UTC-7) it is **12:31pm IST**.
- Best days: Tuesday to Thursday. Avoid US holidays and Monday. TODO: owner picks the date.
- Our India audience is awake in the evening IST, so the first 12 hours of the PH day (1:31pm to 1:31am IST) cover both India and the US evening.

### Pre-launch checklist (start 2 weeks before)

- [ ] Teaser page: "Launching on Product Hunt on <date>", email field. TODO: build, needs an owner decision on where it lives on wavs.co.in.
- [ ] Notify list: existing users, waitlist, X and Instagram followers. TODO: list size is unknown.
- [ ] Hunter: ask someone with a real following, or self-hunt. TODO: name.
- [ ] Complete the PH page: name, tagline, description, 6 to 8 gallery slots, thumbnail, topics, maker profile with photo.
- [ ] Check store listings and the website are live and current (Play listing: `app.waves.mobile`; TODO: confirm App Store link and that the iOS version shows the Watch app).
- [ ] Check onboarding with a fresh account on a clean phone. Bump `app_releases.latest_version` if a release is pending.
- [ ] Draft prepared replies (section below) and put them in a note.
- [ ] Prepare a 15-day Pro trial path (already default for new accounts) so no one hits a paywall.
- [ ] Do not ask for upvotes. Ask people to try it and comment.

### Hour-by-hour (IST, assuming PST start)

| IST               | What                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------- |
| 1:31pm            | Page goes live. Post the first comment immediately.                                          |
| 1:45pm            | Share the link in a personal message to close contacts: "Launching today, feedback welcome". |
| 2:30pm            | X post and Instagram story with the link and the voice demo.                                 |
| 4:00pm            | Reply to every comment so far. Fix any quick bug reports.                                    |
| 7:00pm            | Evening India push: email the notify list, WhatsApp groups and communities.                  |
| 10:00pm           | Post a second X update with a number only if we have a real one. TODO: no invented numbers.  |
| 12:00am           | US morning begins. Answer questions, thank early commenters.                                 |
| 3:00am to 6:00am  | Sleep or have a second maker on call. Reply to anything new.                                 |
| 8:00am            | Check rank, reply to every comment, post a thank-you with real results only.                 |
| 1:31pm (next day) | Day ends. Write a short recap and thank everyone.                                            |

### Five prepared replies

**1. Privacy: where does my data live?**

> Fair question, so here is the plain answer. The ledger on your phone is encrypted at rest. The shared ledger for groups lives on our server, because that is what lets several phones agree, and it is not end-to-end encrypted. Receipt photos can stay on your device or in your own cloud storage. We never sell data. The code is open source on GitHub if you want to check.

**2. How is it different from Splitwise?**

> Splitwise is widely used and has a long track record, and we say so on our comparison page. Where Waves differs: people, expenses and currencies are unlimited on Free, there is no daily limit on new expenses, it works offline first, it hands off to UPI with the exact amount, and voice works in Hindi, Tamil, Arabic and Hinglish. Where Splitwise wins: it is more established, has more app languages, and Pro can import US card transactions (Waves has no bank or card feed). If you are moving over, Settings, Your data, Import from Splitwise brings a group across.

**3. How does offline sync work?**

> Every expense is written to your phone first, so Waves never waits for the network. Changes are sent in order when you are back online, and a retry never counts twice. If the server refuses a change it stays on screen with Try again or Discard. Receipt photos queue and upload later. You can pick Wi-Fi only, mobile data, or both. Basic voice runs on your phone too, once you download a speech language, though joining a group, AI features and payments need a connection.

**4. Pricing outside India?**

> Free works the same everywhere. Pro is Rs 79/month or Rs 699/year in India; in other countries the app store shows your local price, and we do not quote converted numbers. Waves is not tied to a bank or payment network, so it works wherever you can install the app or open the web app. UPI settle-up is built for India; elsewhere Waves hands the amount to your bank transfer, Venmo, PayPal, PayNow, SEPA or cash. TODO: confirm which of these are live in the app per country.

**5. AI and MCP: what can it do?**

> Waves speaks MCP, the open standard for AI assistants. You approve each connection with a Waves sign-in, and it sees only your own groups. You can ask "Who owes me in Goa Trip?" or "Add Rs 2,400 cab to Goa Trip, split equally". It can never move money: for settling it records a payment and gives you a link to pay in your own UPI app. You can disconnect from your assistant any time. It works with Claude, ChatGPT, Cursor, VS Code and any MCP client.

## 7. PH-only offer (DECISION FOR THE OWNER, not a commitment)

Idea: a one-time extension of the new-account Pro trial from 15 days to 30 days for people who sign up from the Product Hunt page, via a link or code. It costs us nothing until they pay, it rewards people who tried it, and it needs no card.

Open questions before anyone promises it:

- Can the trial length be set per link or code today? TODO: check billing and RevenueCat setup; if not, drop the offer.
- Make sure this does not collide with other campaigns or confuse the 15-day default.
- Do not announce it until the owner confirms it works end to end.

Safe default if no offer: say nothing extra. The 15-day Pro trial and free plan are already real.
