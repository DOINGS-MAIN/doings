/**
 * AML same-name check: is the name on a bank account the name of our verified user?
 *
 * Names are compared as sets of words, so order, case and punctuation do not matter. One side may
 * carry extra names (a bank often adds middle names; BVN keeps first and last only), but every
 * name on the shorter side must be found on the longer side. A single letter stands for a name
 * starting with it ("JOHN O" / "John Oluwaseun"), and at least two full names must agree.
 * Titles (MR, DR, ALHAJA…) are ignored.
 *
 * Until release 3 any two shared names passed, so "John Peter Adebayo" matched
 * "Peter Adebayo Smith": same family, different person.
 */

// Banks often put a title in the account name; it is not part of the person's name.
const TITLES = new Set([
  "MR", "MRS", "MISS", "MS", "DR", "PROF", "ENGR", "BARR", "CHIEF", "ALHAJI", "ALHAJA", "HAJIA", "PASTOR", "REV", "HON",
]);

function normalize(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z\s]/g, "")
    .split(/\s+/)
    .filter((word) => word !== "" && !TITLES.has(word))
    .sort();
}

/** How the shorter name sits inside the longer one: full-word matches, and words left unmatched. */
function compare(nameA: string, nameB: string): { full: number; initials: number; unmatched: number; longest: number } {
  const partsA = normalize(nameA);
  const partsB = normalize(nameB);
  const [shorter, longer] = partsA.length <= partsB.length ? [partsA, partsB] : [partsB, partsA];
  const pool = [...longer];
  const left: string[] = [];
  let full = 0;
  for (const word of shorter) {
    // A single letter is an initial, never a full name: "J A" must not match "A J".
    const i = word.length > 1 ? pool.indexOf(word) : -1;
    if (i === -1) left.push(word);
    else {
      pool.splice(i, 1);
      full++;
    }
  }
  // What did not match in full may still match as an initial, either way round.
  let initials = 0;
  for (const word of left) {
    const i = pool.findIndex((other) => (word.length === 1 || other.length === 1) && other[0] === word[0]);
    if (i !== -1) {
      pool.splice(i, 1);
      initials++;
    }
  }
  return { full, initials, unmatched: left.length - initials, longest: longer.length };
}

/** Share of the longer name that the shorter one accounts for in full words, 0–1. */
export function nameMatchScore(nameA: string, nameB: string): number {
  const c = compare(nameA, nameB);
  return c.longest === 0 ? 0 : c.full / c.longest;
}

export function isSamePersonName(verifiedName: string, bankName: string): boolean {
  const c = compare(verifiedName, bankName);
  return c.full >= 2 && c.unmatched === 0;
}
