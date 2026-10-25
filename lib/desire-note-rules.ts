/**
 * Thrown when storing a note would require inventing a rating.
 *
 * `desires.rating` is NOT NULL with CHECK (rating between 1 and 5), so a note
 * cannot be stored without one. That was papered over with
 * `defaultRating = 3`, and 3 is the single worst value to guess. In
 * trigger_reveal():
 *
 *   hard veto         rating > 2        (so 3 survives it)
 *   match             both >= 4         (so 3 is not a match)
 *   Curiosity Bridge  (a >= 4 and b = 3) or (a = 3 and b >= 4)
 *
 * 3 is exactly the bridge threshold. So writing a private note on an item you
 * had never rated recorded you as a 3, and if your partner rated it 4 or 5 the
 * item appeared in the couple's shared Curiosity Bridge — telling both of you
 * that one of you was "open to exploring" it.
 *
 * Verified end to end against the hosted project: a user wrote a note on an
 * unrated item and nothing else, their partner rated it 5, and the item came
 * back inside reveals.mismatches.
 *
 * The user never said they were open to it. They typed a note, on a screen
 * that promises the note is private and encrypted. A private act must not
 * become a shared disclosure about their willingness, so this refuses instead.
 */
export class RatingRequiredError extends Error {
  constructor(
    message = 'Give this item a star rating before adding a note — a note on its own would be recorded as a rating, and ratings are what your reveals are built from.',
  ) {
    super(message);
    this.name = 'RatingRequiredError';
  }
}

/**
 * The rating to store alongside a brand-new note, or a throw.
 *
 * Only called when no `desires` row exists yet: updating an existing row
 * leaves its rating alone, so the question does not arise there.
 */
export function ratingForNewNote(rating: number | null): number {
  if (rating === null) {
    throw new RatingRequiredError();
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    // Matches desires_rating_check. Failing here names the problem instead of
    // surfacing a Postgres constraint violation.
    throw new RatingRequiredError(
      'That rating is not between 1 and 5, so the note cannot be saved against it.',
    );
  }
  return rating;
}
