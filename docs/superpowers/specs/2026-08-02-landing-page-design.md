# Landing Page Redesign — Doings Go-Live

**Date:** 2026-08-02  
**Status:** Approved (open signup CTA)

## Problem

The live site at doingsapp.com is visually polished but fails the 5-second test:

- Headlines are poetic, not explanatory ("Celebrate louder", "Where culture meets technology")
- Jargon ("spray", "drops", "live layer") is never defined for newcomers
- ~10 sections compete for attention (Platform, Experience, Avatars, Trust, testimonials, waitlist)
- Primary CTA is "Join waitlist" while the product is ready to launch

## Product in one sentence

**Doings lets guests send money at live events — weddings, parties, shows — and see their contribution on the big screen with a live leaderboard.**

## Goals

1. A visitor understands what Doings does within 5 seconds
2. One primary action: **Get started** → `/login`
3. Fewer sections, plain English, same dark/gold brand
4. Build in `event-spark` repo and deploy to `doingsapp.com`

## Information architecture

| Section | Purpose |
|---------|---------|
| Nav | Logo + How it works + FAQ + Get started |
| Hero | Headline + one-line explanation + CTA + avatar visual |
| How it works | 3 steps: Join → Fund → Spray |
| Features | 3 cards: Big screen, Leaderboard, Giveaways |
| Trust strip | One line: verified wallets, bank payments, withdraw anytime |
| FAQ | 4 questions with direct answers |
| Footer | Privacy, Terms, Support |

## Copy (final)

**Hero headline:** Send money at live events. See it on the big screen.

**Hero sub:** Doings is the app for spraying at parties, weddings, and shows. Add money to your wallet, celebrate someone live, and watch your name hit the projector.

**Steps:** Join the event → Add money → Spray live

**FAQ:** What is spraying? / Is my money safe? / Do I need to download an app? / Can I withdraw unused balance?

## Routing

- `/` → `LandingPage` (redirect to `/home` if signed in)
- `/login` → `LoginPage` (auth only, no marketing blocks)
- Remove marketing hero/features from login

## Out of scope

- Waitlist form
- Separate host landing
- Light mode toggle on marketing page
- Phone/tablet mockup animations
