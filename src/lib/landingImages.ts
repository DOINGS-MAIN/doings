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
    src: unsplash("photo-1589199051916-92cd36b97ffa", 1000),
    alt: "Guests celebrating at a Nigerian wedding reception",
    location: "Nigeria",
  },
  heroOwambe: {
    src: unsplash("photo-1745918950570-3e3ebf79115a", 1000),
    alt: "People dancing at a colourful owambe celebration",
    location: "Lagos, Nigeria",
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
    join: {
      src: unsplash("photo-1705544363579-2116d47ddceb", 900),
      alt: "Guest scanning a QR code on their phone to join an event",
      location: "Nigeria",
    },
    fund: {
      src: unsplash("photo-1556742502-ec7c0e9f34b1", 900),
      alt: "Person funding a mobile wallet with a smartphone payment",
      location: "Lagos, Nigeria",
    },
    spray: {
      src: unsplash("photo-1705459965544-fcc7ead92d58", 900),
      alt: "Nigerian wedding guests dancing as a spray hits the projector",
      location: "Nigeria",
    },
    giveaway: {
      src: unsplash("photo-1706759755851-6163305080f0", 900),
      alt: "Guest scanning a QR code on a screen to redeem a giveaway drop",
      location: "Nigeria",
    },
  },
  mosaic: [
    {
      src: unsplash("photo-1785631829550-fdf86517231d", 1200),
      alt: "Nigerian wedding couple in Lagos",
      caption: "Lagos owambe",
      location: "Lagos",
    },
    {
      src: unsplash("photo-1767661667474-4f2a197c9a51", 900),
      alt: "DJ performing for a crowd at a Lagos nightclub",
      caption: "Live DJ nights",
      location: "Lagos",
    },
    {
      src: unsplash("photo-1705459965544-fcc7ead92d58", 900),
      alt: "Nigerian wedding guests dancing at a reception",
      caption: "Wedding reception",
      location: "Nigeria",
    },
    {
      src: unsplash("photo-1768767278997-136b49ce5d99", 900),
      alt: "Family celebrating a child's birthday party with balloons",
      caption: "Birthday & parties",
      location: "Nigeria",
    },
  ],
  giveaway: {
    host: unsplash("photo-1761959173350-097e886cd85d", 1400),
    alt: "Crowd at a live event with guests on their phones ready to scan and redeem",
    location: "Nigeria",
  },
  voices: [
    {
      name: "Amara Okafor",
      role: "Guest · Lagos owambe",
      quote:
        "I sprayed from my phone and my name jumped on the projector. The MC called me out and the whole hall went wild.",
      portrait: unsplash("photo-1573496359142-b8d87734a5a2", 400),
      portraitAlt: "Portrait of Amara Okafor",
    },
    {
      name: "Tunde Bakare",
      role: "Event host · Abuja",
      quote:
        "I ran a ₦500k giveaway drop during the reception. Guests scanned the code on the screen and redeemed in seconds.",
      portrait: unsplash("photo-1506794778202-cad84cf45f1d", 400),
      portraitAlt: "Portrait of Tunde Bakare",
    },
    {
      name: "Chioma Nwosu",
      role: "Birthday celebrant · Port Harcourt",
      quote:
        "My cousins in London joined the event link and sprayed live. The leaderboard kept everyone competing all night.",
      portrait: unsplash("photo-1580489944761-15a19d654956", 400),
      portraitAlt: "Portrait of Chioma Nwosu",
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
