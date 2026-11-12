# Bible translations in Tend

Tend only offers a translation when we know we are allowed to store its text and send it in people's messages.
Today that means public-domain translations, whose full text for each passage is kept in `content/library.json` and checked against its source on every change (`scripts/build-library.mjs`).
Everyone picks a default translation in Settings, and can choose a different one for any person on that person's page.
Quotes from books and the conversation starters have their own page: [QUOTES.md](QUOTES.md).

Last checked: 11 November 2026.

## Offered now

All eight are fetched from [bible-api.com](https://bible-api.com), a free, open-source API whose own list ([bible-api.com/data](https://bible-api.com/data)) marks each of them "Public Domain".
Public domain means nobody owns the text any more (or the owner gave it away), so we can store it, show it and send it without asking anyone or paying.

| Code | Translation | Why it is free to use | "Read more" link |
| --- | --- | --- | --- |
| `web` | World English Bible | Dedicated to the public domain by its makers, eBible.org. | Bible Gateway |
| `webbe` | World English Bible, British Edition | The same, with British spelling. | ebible.org |
| `kjv` | King James Version (1611, 1769 text) | Public domain everywhere except the UK, where it is under a Crown patent for printing; quoting it in messages is not printing Bibles, and it is used freely in UK digital services. | Bible Gateway |
| `asv` | American Standard Version (1901) | Its copyright ran out long ago. | Bible Gateway |
| `bsb` | Berean Standard Bible | Its publisher released it into the public domain on 30 April 2023 (see [berean.bible/licensing](https://berean.bible/licensing.htm)). | ebible.org |
| `bbe` | Bible in Basic English (1965) | Published without a copyright notice in the United States, so public domain there. | ebible.org |
| `darby` | Darby Translation (1890) | Its copyright ran out long ago. | Bible Gateway |
| `dra` | Douay-Rheims, 1899 American edition | Its copyright ran out long ago. | Bible Gateway |

The Douay-Rheims follows the Latin Vulgate's numbering of the Psalms, so its "Psalm 23" is a different psalm.
Each Psalm passage therefore has its own Douay-Rheims reference in `content/scripture-refs.json` (for example Psalm 23:1-4 is its Psalm 22:1-4), checked by hand against the text, and its citation uses that number, so it can be found in a Douay-Rheims Bible.

Not offered, although asked about:

- **Young's Literal Translation (YLT)** is public domain, but bible-api.com no longer serves it, and we only add text we can fetch and check automatically.
  It can come back when we add a second source.
- **Open English Bible** is public domain, but its Old Testament is unfinished, so many of our passages would be missing.

## Translations you need a key for (researched, not built)

These publishers let apps fetch their text through a free API, with conditions.
None is built, because each one limits how much text an app may keep, and Tend keeps the full text of every passage it might suggest and puts it inside messages it schedules days ahead.

### English Standard Version (ESV), through Crossway's ESV API

- **Who can use it:** free for non-commercial use, by individuals and ministries.
  "Commercial" includes asking for donations or showing ads or sponsors.
  Use must fit Crossway's statement of faith.
- **Limits:** 5,000 requests a day, 1,000 an hour, 60 a minute; at most 500 verses (or half a book) per request and per page.
- **Keeping text:** an app may keep at most 500 verses at a time, and should clear it now and then.
- **Must show:** the ESV copyright notice, the "ESV" label, and a link to esv.org on every page that shows the text.
- **Would a free public app like Tend qualify?** Probably yes on cost and purpose, since Tend has no ads, fees or donation asks.
  The 500-verse cache is the problem: Tend's library is small enough (43 passages) to fit, but each scheduled message also keeps its text, so we would need to count stored verses carefully.
- Source: [api.esv.org](https://api.esv.org/).

### New Living Translation (NLT), through Tyndale's NLT API

- **Who can use it:** non-commercial use without a key (50 verses per request, 500 requests a day), or with a free key (500 verses per request, 5,000 requests a day).
  Commercial use needs a separate licence.
  Users must agree that their use fits Tyndale's stated purpose.
- **Keeping text:** the API page says nothing about caching or storing text, so we would have to ask Tyndale before storing passages in messages.
- **Must show:** not stated on the API page; Tyndale's usual permissions page asks for the NLT copyright line.
- **Would Tend qualify?** Likely for the free, non-commercial tier, once Tyndale confirms that storing passages in scheduled messages is allowed.
- Source: [api.nlt.to](https://api.nlt.to/).

### API.Bible (American Bible Society), free Starter plan

- **What it gives:** every public-domain and Creative Commons Bible it carries, plus up to three copyrighted translations chosen from those whose publishers allow it on the free plan.
  The NIV is not available for commercial use there; which copyrighted versions are on Starter depends on each publisher.
- **Limits:** 5,000 requests a month (one help page says a day; the plan comparison says a month), no overage on the free plan.
- **Who can use it:** non-commercial only; no ads, fees, in-app purchases or sponsors (a small donation link is tolerated).
- **Keeping text:** cached text must be refreshed at least every 30 days, and kept under 500 consecutive verses.
- **Must do:** show a visible credit and link to api.bible, and report each time Scripture is shown through their tracking script ("FUMS").
  Tend's emails and Signal messages cannot run that script, and the site's strict security policy blocks third-party scripts, so this is the main blocker.
- Sources: [plan comparison](https://care.api.bible/article/378-comparing-api-bible-plans), [FAQ](https://api.bible/faq), [FUMS](https://care.api.bible/article/417-understanding-fums), [licensing quick reference](https://care.api.bible/article/396-licensing-policies-quick-reference).

## Translations that need the publisher's permission

There is no free API for these that fits Tend, so each would need a written agreement with the publisher.
Their printed "you may quote up to N verses" rules are for books and sermons that quote the Bible, not for an app whose purpose is to deliver the text, so we would ask rather than rely on them.

| Translation | Publisher | Where to ask |
| --- | --- | --- |
| New International Version (NIV) | Biblica (Zondervan in the US) | [biblica.com/permissions](https://www.biblica.com/permissions/) |
| New King James Version (NKJV) | Thomas Nelson (HarperCollins Christian Publishing) | [harpercollinschristian.com/permissions](https://www.harpercollinschristian.com/permissions/) |
| Christian Standard Bible (CSB) | Holman Bible Publishers (Lifeway) | [csbible.com/about-the-csb/permissions](https://csbible.com/about-the-csb/permissions/) |
| New American Standard Bible (NASB) | The Lockman Foundation | [lockman.org/permission-to-quote](https://www.lockman.org/permission-to-quote-copyright-trademark-information/) |

## Adding a translation

1. Confirm its licence lets us store and send the full text, and add it to this page with the source.
2. Add its code to `TRANSLATIONS` in `lib/enums.ts` and `scripts/build-library.mjs`, its labels in `lib/item.ts`, and its reading link in the build script.
3. Run `node scripts/build-library.mjs` and commit `content/library.json`.
