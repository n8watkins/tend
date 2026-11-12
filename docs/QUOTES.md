# Quotes and conversation starters in Tend

Tend suggests three kinds of words: Bible passages ([TRANSLATIONS.md](TRANSLATIONS.md)), quotes from books, and short conversation starters.
This page covers the quotes and the starters: where they come from, why we may use them, and how they are checked.

Last checked: 11 November 2026.

## Quotes

Every quote is in `content/quotes.json` and is copied into `content/library.json` by `scripts/build-library.mjs`.
The quotes are the option for people who would rather not get Scripture, so they are not taken from religious scripture.
A few older quotes from devotional writers (Thomas à Kempis, Augustine) remain from the first library.

### Why they are free to use

Each quote is in the public domain: nobody owns the text any more, so we can store it, show it and send it in messages without asking or paying.
For a quote to qualify, both the original and the English translation we use must be in the public domain.
In the United States that means the edition was published before 1930.
Each quote names the Project Gutenberg book it comes from, and Project Gutenberg only publishes texts it has cleared as public domain in the United States.

### How they are checked

`node scripts/build-library.mjs` downloads each Gutenberg book once (cached in `.cache/gutenberg`), and fails unless every quote's text appears in its book word for word.
Only whitespace is normalised, so line breaks in poems become single spaces.
No quote is ever typed from memory, and "attributed to" quotes that do not appear in the source cannot be added.
CI runs the same check (`--check`) on every change to `content/`.

### Sources

| Author | Books (Project Gutenberg number) | Translator | Why it is public domain |
| --- | --- | --- | --- |
| Marcus Aurelius | Thoughts of Marcus Aurelius Antoninus (15877) | George Long, 1862 | Ancient text; translation published 1862. |
| Epictetus | Discourses and Encheiridion (10661); The Golden Sayings of Epictetus (871) | George Long, 1877; Hastings Crossley, 1903 | Ancient text; translations published 1877 and 1903. |
| Seneca | Minor Dialogues (64576); On Benefits (3794) | Aubrey Stewart, 1889 and 1887 | Ancient text; translations published in the 1880s. |
| Ralph Waldo Emerson | Essays: First Series (2944); Essays: Second Series (2945); The Conduct of Life (39827); Society and Solitude (69258) | | Published 1841 to 1870; Emerson died in 1882. |
| Henry David Thoreau | Walden (205); A Week on the Concord and Merrimack Rivers (4232) | | Published 1849 and 1854; Thoreau died in 1862. |
| Walt Whitman | Leaves of Grass (1322) | | The 1891-92 edition; Whitman died in 1892. |
| Emily Dickinson | Poems, Three Series (12242) | | Published 1890 to 1896, edited by Mabel Loomis Todd and T. W. Higginson. |
| Christina Rossetti | Poems (19188); Sing-Song (76703) | | Published 1862 to 1906; Rossetti died in 1894. |
| William Shakespeare | The Complete Works (100) | | Written around 1590 to 1613. |
| Jane Austen | Pride and Prejudice (1342); Emma (158); Persuasion (105); Sense and Sensibility (161); Mansfield Park (141); Northanger Abbey (121) | | Published 1811 to 1817; Austen died in 1817. |
| Louisa May Alcott | Little Women (514); An Old-Fashioned Girl (2787); Work (4770); Jo's Boys (3499) | | Published 1868 to 1886; Alcott died in 1888. |
| Helen Keller | The Story of My Life (2397); Optimism (31622) | | Both published in 1903. See the note below. |
| Lao Tzu | The Tao Teh King (216) | James Legge, 1891 | Ancient text; translation published 1891. |
| Confucius | The Analects (3330) | James Legge, 1861 (revised 1893) | Ancient text; translation published in the 1890s. |
| Rabindranath Tagore | Stray Birds (6524) | Tagore's own English | Published 1916; Tagore died in 1941. |
| Thomas à Kempis | The Imitation of Christ (1653) | William Benham, 1874 | From the first library. |
| Augustine of Hippo | Confessions (3296) | E. B. Pusey, 1838 | From the first library. |
| Boethius | The Consolation of Philosophy (14328) | H. R. James, 1897 | From the first library. |

**Helen Keller:** her two books were published in 1903, so they are public domain in the United States, where Tend is run.
In countries that count from the author's death plus 70 years (the UK and the EU, for example), her work stays in copyright until 1 January 2039, because she died in 1968.
Quoting a sentence or two with credit is normally allowed there as quotation, but it is not public domain there.
Every other author on this list died more than 70 years ago, and every translator too.

Not used, on purpose:

- Modern translations, even of ancient writers, such as Coleman Barks' versions of Rumi or Gregory Hays' Marcus Aurelius: they are still in copyright.
- Quotes found only on quote websites, because many are misattributed.
- Lines that only read well with a lot of explanation, or that use old words a reader today would stumble on.

### Occasions and tone

Each quote has `occasions`, the kinds of moment it suits, and one `tone`.

| Occasion | Use it for |
| --- | --- |
| `birthday` | Birthdays. Nothing about death, age as decline, or regret. |
| `encouragement` | Someone facing something hard, or trying something new. |
| `grief` | Loss of a person, or a loss that feels like one. Comforting, never preachy. |
| `congratulations` | Good news: a new job, an engagement, a finished project. |
| `thinking-of-you` | No special reason; you are simply thinking of them. |
| `gratitude` | Thanking someone. |
| `new-chapter` | A move, a new job, a graduation, a fresh start. |

| Tone | Feels |
| --- | --- |
| `light` | Playful, easy, a small smile. |
| `tender` | Warm and close. |
| `steady` | Calm and grounding. |

A quote can suit several occasions but has one tone.
Every occasion should have at least twenty quotes.

## Conversation starters

`content/prompts.json` holds short first lines for a message, grouped by situation (`birthday`, `been-a-while`, `going-through-something`, `congratulations`, `just-because`), each with a tone.
They are our own words, so there is no copyright question.

They were drafted in one batch with Google Gemini and then edited by hand, line by line.
Nothing is generated while the app runs.

What makes a good starter:

- It sounds like a real text from a friend, and is short.
- It needs no details Tend does not have: no names, dates, places or shared memories ("Remember when...?" is out).
- It does not guess at the situation (a congratulations line should not assume a new job).
- No cliches, no emojis, no em dashes.

`scripts/build-library.mjs` checks that the file is valid, every situation and tone is known, and every id is unique.

## Adding a quote

See [CONTRIBUTING.md](../CONTRIBUTING.md#suggesting-content).
