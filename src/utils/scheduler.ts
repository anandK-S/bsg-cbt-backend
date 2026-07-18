import Exam from '../models/Exam';

/**
 * Starts a background scheduler that runs every minute to:
 * 1. Auto-publish exams whose scheduledStartDate has arrived and are still in Draft.
 * 2. Auto-unpublish (revert to Draft) exams whose scheduledEndDate has arrived and are still Published.
 */
export const startScheduler = (): void => {
  console.log('[Scheduler] Auto-publish/unpublish scheduler started (interval: 60s)');

  setInterval(async () => {
    const now = new Date();

    try {
      // --- Auto-publish ---
      const publishResult = await Exam.updateMany(
        {
          status: 'Draft',
          scheduledStartDate: { $ne: null, $lte: now },
        },
        { $set: { status: 'Published' } }
      );

      if (publishResult.modifiedCount > 0) {
        console.log(
          `[Scheduler] Auto-published ${publishResult.modifiedCount} exam(s) at ${now.toISOString()}`
        );
      }

      // --- Auto-unpublish ---
      const unpublishResult = await Exam.updateMany(
        {
          status: 'Published',
          scheduledEndDate: { $ne: null, $lte: now },
        },
        { $set: { status: 'Draft' } }
      );

      if (unpublishResult.modifiedCount > 0) {
        console.log(
          `[Scheduler] Auto-unpublished ${unpublishResult.modifiedCount} exam(s) at ${now.toISOString()}`
        );
      }
    } catch (err) {
      console.error('[Scheduler] Error during auto-publish/unpublish check:', err);
    }
  }, 60 * 1000); // every 60 seconds
};
