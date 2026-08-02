/** Verified Unsplash assets — Nigeria / African celebrations (Unsplash License). */

function unsplash(id: string, w = 1600) {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;
}

export const landingImages = {
  /** Lagos wedding — Ben Iwara */
  heroMain: {
    src: unsplash("photo-1785631829550-fdf86517231d", 2200),
    alt: "Nigerian wedding couple celebrating in Lagos",
    location: "Lagos, Nigeria",
  },
  heroInset: {
    src: unsplash("photo-1752344062867-65eecc235111", 1000),
    alt: "Guests celebrating at a traditional African ceremony",
    location: "Southern Africa",
  },
  heroOwambe: {
    src: unsplash("photo-1745918950570-3e3ebf79115a", 1000),
    alt: "People dancing at a colourful cultural celebration",
    location: "Nigeria",
  },
  /** Venue for projector showcase — wedding reception energy */
  projectorVenue: {
    src: unsplash("photo-1705459965544-fcc7ead92d58", 2000),
    alt: "Nigerian wedding guests dancing at a reception",
    location: "Nigeria",
  },
  story: {
    src: unsplash("photo-1739526169655-0378b9aae5ab", 1400),
    alt: "Couple and guests at a Nigerian wedding celebration",
    location: "Nigeria",
  },
  steps: {
    join: unsplash("photo-1529519195486-16945f0fb37f", 900),
    fund: unsplash("photo-1549383433-0d8ef3f38afa", 900),
    spray: unsplash("photo-1618999114008-fbf937170cdb", 900),
    giveaway: unsplash("photo-1577138017060-8ed59846a432", 900),
  },
  mosaic: [
    {
      src: unsplash("photo-1785631829550-fdf86517231d", 1200),
      alt: "Nigerian wedding couple in Lagos",
      caption: "Lagos owambe",
      location: "Lagos",
    },
    {
      src: unsplash("photo-1752344062867-65eecc235111", 900),
      alt: "Traditional ceremony celebration",
      caption: "Traditional ceremony",
      location: "Nigeria",
    },
    {
      src: unsplash("photo-1589199051916-92cd36b97ffa", 900),
      alt: "African wedding celebration with guests",
      caption: "Wedding reception",
      location: "Nigeria",
    },
    {
      src: unsplash("photo-1649677874593-a04cb075c7a0", 900),
      alt: "Guests celebrating at an event",
      caption: "Birthday & parties",
      location: "Nigeria",
    },
  ],
  giveaway: {
    host: unsplash("photo-1745918950570-3e3ebf79115a", 1400),
    alt: "Guests celebrating — host drops cash prizes guests redeem on their phones",
    location: "Nigeria",
  },
  voices: [
    {
      name: "Amara Okafor",
      role: "Guest · Lagos owambe",
      quote:
        "I sprayed from my phone and my name jumped on the projector. The MC called me out — the whole hall went wild.",
      portrait: unsplash("photo-1577138017060-8ed59846a432", 400),
    },
    {
      name: "Tunde Bakare",
      role: "Event host · Abuja",
      quote:
        "I ran a ₦500k giveaway drop during the reception. Guests scanned the code on the screen and redeemed in seconds.",
      portrait: unsplash("photo-1507003211169-0a1dd7228f2d", 400),
    },
    {
      name: "Chioma Nwosu",
      role: "Birthday celebrant · Port Harcourt",
      quote:
        "My cousins in London joined the event link and sprayed live. The leaderboard kept everyone competing all night.",
      portrait: unsplash("photo-1534528741775-53994a69daeb", 400),
    },
  ],
  cta: {
    src: unsplash("photo-1739526169655-0378b9aae5ab", 1800),
    alt: "Nigerian wedding celebration",
    location: "Nigeria",
  },
} as const;

export const landingScreenMock = {
  eventName: "Ada & Tunde's Owambe",
  liveSpray: { name: "Zara M.", amount: "₦50,000" },
  leaderboard: [
    { rank: 1, name: "Ayo K.", amount: "₦285,000" },
    { rank: 2, name: "Zara M.", amount: "₦190,000" },
    { rank: 3, name: "Emeka O.", amount: "₦120,000" },
  ],
  giveaway: {
    title: "Birthday Drop",
    amount: "₦5,000",
    code: "DOINGS-24",
    spotsLeft: 12,
  },
} as const;
