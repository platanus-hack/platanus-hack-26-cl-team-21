import { randomInt } from "node:crypto";

// Pseudonyms and enrollment codes. Pure helpers: no DB access, safe to unit test.
//
// Code format: the study prefix and the participant number the seed uses ('EAT-001-P01'), plus a
// random suffix ('EAT-001-P04-7KQ3XA'). The code is a bearer credential until the app redeems it
// (POST /api/v1/enrollments matches it exactly), so it must not be guessable from the pseudonym,
// and regenerating one must yield a different value.

/** Pseudonyms only: letters, a dash and a number ('P-004'). Rules out names or other identity data. */
export const PSEUDONYM_PATTERN = /^[A-Z]{1,4}-\d{2,5}$/;

const NUMBERED_P = /^P-(\d+)$/;

/** The next free 'P-NNN' pseudonym after the highest one in use (P-001 when there is none). */
export function nextPseudonym(existing: string[]) {
  let max = 0;
  let width = 3;
  for (const pseudonym of existing) {
    const digits = NUMBERED_P.exec(pseudonym)?.[1];
    if (!digits) continue;
    max = Math.max(max, Number(digits));
    width = Math.max(width, digits.length);
  }
  return `P-${String(max + 1).padStart(width, "0")}`;
}

// Prefix of an existing code: 'EAT-001' in 'EAT-001-P01' or 'EAT-001-P04-7KQ3XA'.
const CODE_PREFIX = /^([A-Z0-9]+(?:-[A-Z0-9]+)*?)-[A-Z]{1,4}\d{2,5}(?:-[A-Z0-9]+)?$/;

/**
 * The study's code prefix: taken from the codes already handed out in the study (so new codes
 * match the seeded ones), else derived from the study code ('study-eating-001' → 'EAT-001').
 */
export function codePrefix(studyCode: string, existingCodes: string[]) {
  for (const code of existingCodes) {
    const prefix = CODE_PREFIX.exec(code)?.[1];
    if (prefix) return prefix;
  }
  const words = studyCode
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((word) => word && word !== "STUDY");
  const name = words.find((word) => /[A-Z]/.test(word))?.replace(/[0-9]/g, "").slice(0, 3);
  const number = words.findLast((word) => /^\d+$/.test(word));
  return [name, number].filter(Boolean).join("-") || "OLM";
}

// No 0/O, 1/I/L: the participant types the code into the app.
const SUFFIX_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const SUFFIX_LENGTH = 6;

/** 'P-004' → 'P04': the participant part of the code, as in the seed. */
function participantPart(pseudonym: string) {
  const [, letters = "P", digits = "0"] = /^([A-Z]+)-(\d+)$/.exec(pseudonym) ?? [];
  return `${letters}${String(Number(digits)).padStart(2, "0")}`;
}

export function newEnrollmentCode(prefix: string, pseudonym: string) {
  let suffix = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) suffix += SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)];
  return `${prefix}-${participantPart(pseudonym)}-${suffix}`;
}
