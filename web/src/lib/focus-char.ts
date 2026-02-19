/**
 * Compute the Optimal Recognition Point (ORP) for a word.
 * The ORP is the character the eye naturally fixates on — typically
 * slightly left of centre for English words.
 *
 * Returns an object that splits the word into three parts:
 *   before  – characters before the focus letter (render right-aligned)
 *   focus   – the single focus character (render in accent colour, fixed centre)
 *   after   – characters after the focus letter (render left-aligned)
 */
export interface FocusResult {
  before: string;
  focus: string;
  after: string;
  focusIndex: number;
}

export function computeFocus(word: string): FocusResult {
  const len = word.length;

  let focusIndex: number;

  if (len <= 1) {
    focusIndex = 0;
  } else if (len <= 3) {
    focusIndex = 1; // second character
  } else if (len <= 5) {
    focusIndex = 1; // second character
  } else if (len <= 9) {
    focusIndex = 2; // third character
  } else if (len <= 13) {
    focusIndex = 3; // fourth character
  } else {
    focusIndex = 4; // fifth character for very long words
  }

  return {
    before: word.slice(0, focusIndex),
    focus: word[focusIndex],
    after: word.slice(focusIndex + 1),
    focusIndex,
  };
}
