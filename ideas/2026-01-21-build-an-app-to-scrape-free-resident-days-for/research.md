# Chicago Free Resident Days App - Exploration

## Core Insight Deconstruction

The underlying insight here is threefold:

1. **Information asymmetry creates missed value** - Chicago offers numerous free admission days at museums, zoos, gardens, and cultural institutions for residents, but this information is fragmented across dozens of websites, each with their own calendars, eligibility rules, and update schedules.

2. **Temporal relevance is key** - A static list is nearly useless. The value comes from knowing what's free *today*, *this weekend*, or *when I'm actually free*. This is a calendar problem disguised as a directory problem.

3. **Civic benefit meets personal planning** - These programs exist to increase cultural access, but friction in discovery undermines that goal. Reducing friction serves both individual users and the broader civic intent.

## Directions to Explore

### Direction 1: Pure Scraper + Static Site

- **Description:** Build scrapers for each institution's calendar, aggregate into a single JSON feed, publish as a minimal static site (perhaps using the recutils format from your prior research for the data layer). No accounts, no backend, just a daily-updated list.
- **Why it could work:** Extremely low maintenance cost, can be run on GitHub Actions for free, no infrastructure to manage. Fits the "tools, not products" ethos.
- **Risks:** Scraping is brittle—sites change, some use JavaScript rendering, anti-bot measures. Could break silently. Also, no personalization.
- **First step:** Audit 5-10 major Chicago institutions (Art Institute, Field Museum, Shedd, MSI, Lincoln Park Zoo, etc.) and catalog their calendar URL structures and data formats.

### Direction 2: Calendar Subscription Feed (ICS)

- **Description:** Instead of (or in addition to) a website, generate an ICS calendar feed that users can subscribe to in their existing calendar apps. Each free day becomes an all-day event with the institution name, address, and any eligibility notes.
- **Why it could work:** Meets users where they already live—their calendar. Zero app switching. Passive discovery. Could reference your minimalist AI calendar research for sync patterns.
- **Risks:** ICS feeds are pull-based and cache unpredictably. Users might see stale data. Also limited in richness—no images, no deep linking.
- **First step:** Generate a sample ICS file manually with 10 upcoming free days and test subscription behavior across Google Calendar, Apple Calendar, and Outlook.

### Direction 3: SMS/Push Notification Service

- **Description:** Let users subscribe to alerts (SMS, email, or push) based on preferences: "Tell me about any free days in the next 7 days" or "Alert me when the Art Institute has a free day." Proactive nudges rather than passive discovery.
- **Why it could work:** Solves the "I forgot to check" problem. High engagement potential for time-sensitive info.
- **Risks:** Requires user accounts, preferences storage, notification infrastructure. Much more complex. Potential cost at scale (SMS fees, push services).
- **First step:** Define 3-5 notification "recipes" that would cover most use cases and sketch the preference UI.

### Direction 4: Civic Data Partnership

- **Description:** Instead of scraping, reach out to Choose Chicago, the Chicago Cultural Alliance, or individual institutions to get official data feeds or partnership. Position as a civic tech project that amplifies their programs.
- **Why it could work:** Clean data, no scraping fragility, potential for co-promotion. Some cities have official APIs for this kind of civic info.
- **Risks:** Slow—requires relationship building, likely bureaucratic. Might never materialize. Also removes the "just build it" energy.
- **First step:** Research whether Chicago has any existing open data portals covering cultural events. Check data.cityofchicago.org.

### Direction 5: Community-Sourced Corrections

- **Description:** Accept that scrapers will break. Build a lightweight community layer—maybe just a GitHub repo where anyone can submit corrections, add new institutions, or flag outdated info. Use GitHub Actions to merge validated changes into the live feed.
- **Why it could work:** Distributes the maintenance burden. Creates investment from users. Aligns with open-source ethos.
- **Risks:** Requires critical mass of contributors. Could become a ghost town. Also, spam/vandalism potential (though low for this niche).
- **First step:** Design the contribution format—perhaps a simple YAML or recutils file per institution, with schema validation on PR.

### Direction 6: "Free Day Trip Planner" with Context

- **Description:** Go beyond listing free days—help users plan around them. Show nearby free parking, CTA routes, nearby restaurants with lunch specials, estimated crowd levels, what exhibits are currently showing. Turn a free museum day into a complete outing.
- **Why it could work:** Dramatically higher value per visit. Differentiates from a simple calendar. Could integrate Schema.org data (your prior research).
- **Risks:** Scope explosion. Each additional data source is another scraping target. Could become unwieldy.
- **First step:** Pick one institution and manually assemble a "complete outing" data package to see what's actually useful.

### Direction 7: Embeddable Widget for Local Media

- **Description:** Build an embeddable widget that local news sites, blogs, or community organizations could drop into their pages. "This week's free days" as a reusable component.
- **Why it could work:** Distribution through existing trusted channels. Could drive organic traffic back to main site. Serves local journalism's community mission.
- **Risks:** Requires polished, reliable widget. Support burden if widely adopted. Also, modern sites might have CSP restrictions on embeds.
- **First step:** Build a simple iframe-based widget and test embedding in a personal blog.

### Direction 8: Hyperlocal Expansion Framework

- **Description:** Design the architecture so the Chicago scraper is just the first instance. Build it as a framework where someone could fork and adapt for NYC, LA, or any city with similar programs. Parameterized by city + institution list.
- **Why it could work:** Multiplies impact. Attracts contributors who want it for their city. Could become a mini-movement.
- **Risks:** Premature generalization before proving value in one city. Different cities have wildly different program structures.
- **First step:** Identify 2-3 other cities known for free museum days (NYC has culture pass, many cities have "first Sunday free" patterns) and assess structural similarities.

## Unexpected Connections

- **Recutils as data layer** - Your prior research on recutils could be perfect here. Each institution is a record, each free day is a record linked to it. Human-readable, git-diffable, no database needed.

- **Card game generator logic** - The constraint-based generation from your card game research could apply here: "Generate a weekend plan given: 2 free museums, 1 outdoor activity, must include lunch, budget $40." Combinatorial planning on top of the calendar data.

- **Bookmarking app's "surfacing" problem** - Your bookmarking research was about re-surfacing saved items at the right moment. Same core problem: these free days are "bookmarked" by the city, but users need them surfaced when relevant.

- **Weather integration** - A free day at Lincoln Park Zoo is very different in January vs. June. Layering weather data could help users decide which free days are actually worth taking.

- **Proof of residency angle** - Many free days require proof of Chicago residency (utility bill, ID). The app could include "what to bring" reminders—a small but high-value detail.

## Questions Worth Answering

1. **What's the complete list of Chicago institutions offering free resident days?** This seems knowable but I've never seen a canonical list. Is it 15 places? 50?

2. **How often do the free day schedules change?** Are they set annually, quarterly, or do they shift month-to-month? This determines scraping frequency.

3. **Are there legal/ToS concerns with scraping these calendars?** Most are public info, but some sites have aggressive ToS. Worth reviewing before investing heavily.

4. **What's the actual user journey today?** How do Chicagoans currently discover free days? Word of mouth? Googling per-institution? Is there a subreddit or Facebook group serving this need already?

5. **Would a "free day" notification feel like a gift or like spam?** User psychology matters—is this delightful or annoying? Probably depends on frequency and relevance.

6. **Is there a sustainable model here, or is this purely a public good project?** Not that it needs to make money, but understanding the long-term maintenance commitment is important.