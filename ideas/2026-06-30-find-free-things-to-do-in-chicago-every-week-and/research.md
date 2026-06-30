# Find Free Things to Do in Chicago - Exploration

## Core Insight Deconstruction

At its foundation, this idea addresses three interconnected needs:

1. **Discovery Problem**: Cities are rich with free activities, but they're fragmented across dozens of sources—neighborhood blogs, library websites, museum calendars, park district pages, venue social media, etc.

2. **Curation Gap**: Not all free events are created equal. People want relevant, quality recommendations filtered by their interests, location, and schedule—not a firehose of every garage sale and community meeting.

3. **Habit Formation**: Passive awareness creates action. A weekly email creates a ritual touchpoint that transforms "I should do more" into actual calendar entries.

The underlying insight is that **the barrier to urban engagement isn't cost—it's awareness and activation energy**. By aggregating, curating, and delivering opportunities at a predictable cadence, you reduce friction from "search mode" to "choose mode."

## Directions to Explore

### Direction 1: Chicago-First MVP

- **Description:** Build a focused weekly email newsletter specifically for Chicago, manually curated at first, with 5-10 high-quality free events categorized by type (arts, outdoors, community, learning). Simple signup form, Buttondown/Substack for delivery, start with personal research plus 3-5 reliable sources.
- **Why it could work:** Manual curation ensures quality from day one. Small scope makes it launchable in a weekend. Chicago has massive population density (2.7M+ city, 9M+ metro) so even tiny conversion rates yield meaningful audience. You become the trusted filter.
- **Risks:** Manual curation doesn't scale. Burnout after 8-12 weeks when novelty fades. Hard to monetize without sufficient scale. Competing with existing players like Time Out Chicago, Choose Chicago, local bloggers.
- **First step:** Spend one week documenting where you currently find free events. Build a list of 20 sources. Curate one mock newsletter to test the format.

### Direction 2: The Aggregation Engine

- **Description:** Build automated scrapers/API integrations for major free event sources (Chicago Park District, Chicago Public Library, Eventbrite free filter, museum free days, Millennium Park calendar). Use LLMs to standardize data, extract key details, and categorize. Generate newsletter programmatically with minimal human oversight.
- **Why it could work:** Automation enables scale and consistency. Can cover 100+ events per week vs. 10 manually. Technical moat—most competitors rely on manual posting or single-source feeds. Could expand to other cities by adding new scrapers.
- **Risks:** Data quality issues (scrapers break, event details are incomplete, venues use non-standard formats). Legal/TOS concerns with aggressive scraping. Still need human judgment for "is this actually interesting?" False positives overwhelm users.
- **First step:** Audit 10 major Chicago event sources. Map their data structures (JSON APIs, structured HTML, iCal feeds). Build proof-of-concept scraper for Chicago Park District events.

### Direction 3: Personalization Layer

- **Description:** Let users set preferences: neighborhoods (Logan Square, Pilsen, Loop), interests (live music, art, outdoor, family-friendly), notification timing (Sundays at 10am, Wednesdays at 6pm). Use a simple preference quiz at signup, then tailor the weekly email to show most relevant 5-7 events with a "full calendar" link.
- **Why it could work:** Reduces noise and increases engagement. Someone in Wicker Park doesn't care about South Side events. Parents need different recommendations than 20-somethings. Higher open rates and click-through when content feels personally relevant.
- **Risks:** Cold start problem—need enough events to serve all preference combinations. Complexity creeps in (preference management UI, segmentation logic). Risk of over-filtering and missing serendipity.
- **First step:** Design a 5-question preference flow. Create manual segments for one week's events (e.g., "North Side + Music" vs "South Side + Family"). A/B test generic vs. segmented newsletters with 20 friends.

### Direction 4: Community-Sourced Discovery

- **Description:** Build a platform where locals submit free events they discover. Simple submission form (event name, date, location, description, link). Moderate submissions, then feature best ones in weekly email. Gamify with leaderboards, badges for top contributors, or "Event Scout of the Month."
- **Why it could work:** Taps into local knowledge—residents know hyperlocal events that never hit official calendars. Creates engagement loop beyond passive consumption. User-generated content scales better than solo curation. Community feels ownership.
- **Risks:** Moderation burden (spam, low-quality submissions, duplicate events). Requires critical mass of contributors before it's useful. Quality control is harder. Legal liability if someone submits misleading info.
- **First step:** Create Google Form for event submissions. Recruit 10 friends to submit events for 2 weeks. Assess submission quality and volume. Calculate moderation time per event.

### Direction 5: The Event Confirmation Layer

- **Description:** Don't just list events—verify they're actually happening. Check venue websites 24-48 hours before, note cancellations/changes, send update emails. Build reputation as "the reliable source" that saves users from showing up to cancelled events.
- **Why it could work:** Trust is a moat. Competing newsletters and calendars often list outdated info. Users will pay premium (via attention or money) for reliability. Reduces user frustration and builds brand loyalty.
- **Risks:** Extremely labor-intensive without automation. Can't verify everything at scale. Venues change plans last-minute. You become liable if something is wrong.
- **First step:** For one week's curated events, manually verify each one 24 hours prior. Document how long this takes and what percentage had changes. Prototype an automated checker for venue websites/social media.

### Direction 6: Niche Down Dramatically

- **Description:** Instead of "all free Chicago events," focus on one category: "Free Live Music in Chicago" or "Free Outdoor Activities in Chicago" or "Free Family Events in Chicago." Own that specific niche completely with daily/weekly updates.
- **Why it could work:** Easier to become THE authority. Smaller competition. Clearer value proposition for specific audience. Simpler sourcing (fewer places to monitor). Better monetization options (sponsor a music venue, partner with outdoor brands).
- **Risks:** Smaller total addressable market. Seasonal issues (outdoor events die in Chicago winter). Harder to pivot if niche doesn't resonate. May still need multiple events per week to feel valuable.
- **First step:** Research 5 potential niches. For each, spend 2 hours finding this week's events. Measure: How many events exist? How hard to find? Who else covers this? Which excites you most?

### Direction 7: The Social Calendar

- **Description:** Users don't just get event recommendations—they see which friends/contacts are attending. Integration with "Add to Calendar" plus social layer. "3 people in your network marked 'interested' in this event." Becomes a coordination tool, not just discovery.
- **Why it could work:** Social proof drives attendance. Going alone is a barrier; knowing friends might be there reduces friction. Creates viral loops (invites to see social calendar). Solves "I'd like to do more" by making it social rather than solo.
- **Risks:** Cold start—needs critical mass of users before social features work. Privacy concerns. Technically complex (need social graph, authentication, event RSVPs). Competing with Facebook Events, Eventbrite, Meetup.
- **First step:** Survey 20 people: "Would you be more likely to attend a free event if you knew friends were going?" Build clickable prototype showing event + social layer. Test concept validation before building.

### Direction 8: Hyperlocal Neighborhood Editions

- **Description:** Instead of citywide Chicago email, create separate newsletters for specific neighborhoods: "Free Things in Wicker Park," "Free Things in Pilsen," "Free Things in Hyde Park." Each one is short (3-5 events) but hyper-relevant.
- **Why it could work:** Chicago is really a collection of neighborhoods with distinct identities. Local pride drives engagement. Easier to find neighborhood-specific events smaller venues don't promote citywide. Can partner with neighborhood associations, local businesses.
- **Risks:** Requires critical mass in each neighborhood to be valuable. Multiplication of effort (curating 10 newsletters vs. 1). Uneven event distribution (Loop has tons, residential neighborhoods less). User might live in one neighborhood, work in another.
- **First step:** Pick one neighborhood you know well. Curate 4 weeks of neighborhood-specific content. Survey locals: Would you subscribe to this? How many events/week feels right? Test whether people care about neighborhood boundaries.

### Direction 9: The Discovery Journal

- **Description:** Not just a calendar—blend event listings with stories/reports from people who attended. "Last week 12 subscribers went to the free concert at Millennium Park—here's what they thought." Mix curation with community documentation. Every week: upcoming events + recap of past ones.
- **Why it could work:** Adds social proof and vicarious experience. Helps people understand what events are actually like (photos, vibes, tips). Creates content flywheel where attendees want to contribute their experiences. More engaging than pure listings.
- **Risks:** Requires user participation and content creation. Privacy issues with photos/stories. Takes time to build habit of users submitting recaps. Might bury the core value (finding this week's events) in fluff.
- **First step:** Attend 3 free events yourself. Write short recaps (150 words, 2-3 photos). Mock up newsletter format mixing upcoming + recap sections. Share with friends for feedback on format.

### Direction 10: The "Yes Theory" Commitment Mode

- **Description:** Users don't just get event suggestions—they commit to attending at least one free event per week. Accountability features: calendar integration, reminder texts, weekly check-in asking "Did you go? How was it?" Gamification with streaks, badges. Focus on habit formation over passive browsing.
- **Why it could work:** Addresses the real problem—not awareness but action. Accountability increases follow-through. Creates engaged community of active participants, not passive readers. Could build into premium product (coaching, group events, accountability partners).
- **Risks:** High pressure might drive unsubscribes. Requires more user effort (check-ins, reporting). Guilt/shame if people don't follow through. May need human support/community management.
- **First step:** Test with small cohort of 10 friends for 4 weeks. Weekly commitment: attend 1 event, report back. Measure: completion rate, satisfaction, what helped/hindered. Is accountability valuable or annoying?

## Unexpected Connections

**Cross-pollination with existing research:**
- The "bookmarking app that encourages surfacing" idea (2026-01-10) shares the pattern of *temporal prompting to surface relevant content*—could events be "bookmarked" throughout the week then surfaced Sunday?
- "Scrape free resident days for museums" (2026-01-21, 2026-01-22) is directly adjacent—free museum days are a category within free Chicago events
- "Opportunist" app (2026-02-21) has similar DNA—nighttime prompting to create tomorrow's opportunities

**Unusual combinations:**
- **Weather integration:** Only surface outdoor events if forecast is good; automatically prioritize indoor alternatives during bad weather weeks
- **Transit routing:** Tag events by CTA accessibility; "You can reach 8 of these events from the Red Line"
- **Effort scoring:** Rate events by energy required (passive observation vs. active participation) for different mood states
- **Time sensitivity tiers:** Some free events require advance registration (limited spots), some are walk-up, some are ongoing—surface high-friction ones earlier in the week

**What-if scenarios:**
- What if the email included a "mystery event"—one surprise recommendation with minimal details to encourage serendipity?
- What if users could text back "Book it" and you'd auto-add to their Google Calendar?
- What if there was a physical map/zine version distributed at coffee shops, not just digital?
- What if you partnered with one venue per week for "bonus" coverage in exchange for them promoting your newsletter?

## Questions Worth Answering

**Market validation:**
- How many Chicagoans currently subscribe to local event newsletters? What are open rates?
- What do people mean by "do more"—frequency (once/week? once/month?), variety, or social connection?
- Is the constraint really money, or is it time/energy/awareness/social?

**Competition mapping:**
- Who else does this? (Time Out Chicago, Do312, Choose Chicago, Eventbrite, local blogs) What's their coverage quality and freshness?
- Why would someone choose your email over scrolling Instagram or checking Facebook Events?
- Can this be a sustainable business or is it a passion project?

**Technical feasibility:**
- Which Chicago event sources have APIs vs. requiring scraping? What are TOS restrictions?
- How much does it cost to send 10K emails/week? (Mailchimp, Buttondown, SendGrid pricing)
- Can LLMs reliably extract/categorize event data from messy sources?

**Operational reality:**
- How many hours/week does manual curation require at different scales (100 readers? 10K readers?)?
- What's the minimum viable frequency—weekly, twice/week, daily digest?
- How do you handle January/February when Chicago has fewer outdoor events?

**Monetization:**
- Would people pay $3-5/month for premium features (personalization, more events, no ads)?
- Would venues pay for featured placement or sponsored sections?
- Is affiliate revenue possible (book tickets to paid events through your links)?

**User behavior:**
- Do people read these emails on phones or desktop? Morning or evening?
- What's the conversion rate from "read email" to "add to calendar" to "actually attend"?
- How many events do people want to choose from—5? 15? 50?