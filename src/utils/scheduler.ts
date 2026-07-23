import { supabase } from '../config/supabase';

/**
 * Starts a background scheduler that runs every minute to:
 * 1. Auto-publish exams whose scheduledStartDate has arrived and are still in Draft.
 * 2. Auto-unpublish (revert to Draft) exams whose scheduledEndDate has arrived and are still Published.
 */
export const startScheduler = (): void => {
  console.log('[Scheduler] Auto-publish/unpublish scheduler started (interval: 60s)');

  setInterval(async () => {
    const now = new Date().toISOString();

    try {
      // --- Auto-publish ---
      const { data: publishData, error: publishError } = await supabase
        .from('exams')
        .update({ status: 'Published' })
        .eq('status', 'Draft')
        .lte('scheduled_start_date', now)
        .select();

      if (publishData && publishData.length > 0) {
        console.log(`[Scheduler] Auto-published ${publishData.length} exam(s) at ${now}`);
      }

      // --- Auto-unpublish ---
      const { data: unpublishData, error: unpublishError } = await supabase
        .from('exams')
        .update({ status: 'Draft' })
        .eq('status', 'Published')
        .lte('scheduled_end_date', now)
        .select();

      if (unpublishData && unpublishData.length > 0) {
        console.log(`[Scheduler] Auto-unpublished ${unpublishData.length} exam(s) at ${now}`);
      }
    } catch (err) {
      console.error('[Scheduler] Error during auto-publish/unpublish check:', err);
    }
  }, 60 * 1000); // every 60 seconds
};
