import mongoose from 'mongoose';
import { createClient } from '@supabase/supabase-js';
import User from './src/models/User';
import Exam from './src/models/Exam';
import Question from './src/models/Question';

const MONGO_URI = "mongodb+srv://anandkumarar2020_db_user:BDpAQMriRvGJHrLs@bsg-cbt-cluster.4atelxi.mongodb.net/test?appName=bsg-cbt-cluster";
const SUPABASE_URL = "https://wgvmxvqejklwaldqfjwb.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "sb_secret_FNqdX4v85TOTgPc9w9lrBg_XjjOt0ty";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runMigration() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB.");

  // Dictionaries to map old Mongo ObjectIDs to new Supabase UUIDs
  const userMap: Record<string, string> = {};
  const examMap: Record<string, string> = {};
  
  // 1. Migrate Examiners
  console.log("\n--- Migrating Examiners ---");
  const examiners = await User.find({ role: 'Examiner' });
  console.log(`Found ${examiners.length} examiners.`);
  
  for (const ex of examiners) {
    const rawPassword = "BsgCbt@123"; // Using generic secure password
    
    // Create in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: ex.email,
      password: rawPassword,
      email_confirm: true,
      user_metadata: { full_name: ex.name, role: ex.role }
    });
    
    if (authError) {
      console.error(`Failed to create auth user for ${ex.email}:`, authError.message);
      // Fallback: maybe they already exist? Let's check
      const { data: existingUser } = await supabase.from('profiles').select('id').eq('email', ex.email).single();
      if (existingUser) {
        userMap[ex._id.toString()] = existingUser.id;
        console.log(`   Mapped existing user ${ex.email} to ${existingUser.id}`);
      }
      continue;
    }
    
    const newId = authData.user.id;
    userMap[ex._id.toString()] = newId;
    console.log(`Migrated examiner ${ex.email} -> ${newId} (Password: ${rawPassword})`);
    
    // Ensure profile is updated properly since we're using Service Role
    await supabase.from('profiles').upsert({
      id: newId,
      name: ex.name,
      email: ex.email,
      role: 'Examiner',
      status: 'Active'
    });
  }
  
  // 2. Migrate Exams
  console.log("\n--- Migrating Exams ---");
  const exams = await Exam.find({});
  console.log(`Found ${exams.length} exams.`);
  
  let insertedExamCount = 0;
  for (const exam of exams) {
    const oldCreatorId = exam.creatorId.toString();
    const newCreatorId = userMap[oldCreatorId];
    
    if (!newCreatorId) {
      console.warn(`Skipping exam "${exam.title}" because creator ${oldCreatorId} was not migrated (maybe they were not an Examiner?).`);
      continue;
    }
    
    const { data: insertedExam, error: examError } = await supabase.from('exams').insert({
      title: exam.title,
      description: exam.description || '',
      category: exam.category || '',
      creator_id: newCreatorId,
      duration_minutes: exam.durationMinutes,
      duration_seconds: exam.durationSeconds || 0,
      duration_unit: exam.durationUnit || 'min',
      passing_marks: exam.passingMarks || 50,
      passing_criteria_type: exam.passingCriteriaType || 'percentage',
      status: exam.status || 'Draft',
      allow_multiple_attempts: exam.allowMultipleAttempts || false,
      issue_certificate: exam.issueCertificate || false,
      release_results_instantly: exam.releaseResultsInstantly || false,
      test_key: exam.testKey || null
    }).select().single();
    
    if (examError) {
      console.error(`Failed to insert exam "${exam.title}":`, examError.message);
      continue;
    }
    
    examMap[exam._id.toString()] = insertedExam.id;
    insertedExamCount++;
    console.log(`Migrated exam "${exam.title}" -> ${insertedExam.id}`);
  }
  
  // 3. Migrate Questions
  console.log("\n--- Migrating Questions ---");
  const questions = await Question.find({});
  console.log(`Found ${questions.length} questions.`);
  
  let insertedQuestionCount = 0;
  for (const q of questions) {
    const oldExamId = q.examId.toString();
    const newExamId = examMap[oldExamId];
    
    if (!newExamId) {
      // Exam was skipped, so skip question
      continue;
    }
    
    const { error: qError } = await supabase.from('questions').insert({
      exam_id: newExamId,
      text: q.text,
      options: q.options || [],
      correct_option_index: q.correctOptionIndex || 0,
      type: q.type || 'SingleChoice',
      marks: q.marks || 1,
      media_url: q.mediaUrl || null,
      text_hindi: q.textHindi || null,
      options_hindi: q.optionsHindi || [],
      category: q.category || null
    });
    
    if (qError) {
      console.error(`Failed to insert question "${q.text.substring(0, 20)}...":`, qError.message);
      continue;
    }
    
    insertedQuestionCount++;
  }
  console.log(`Successfully migrated ${insertedQuestionCount} questions.`);
  
  console.log("\n--- MIGRATION COMPLETE ---");
  console.log("Please provide the user with their examiner passwords.");
  
  process.exit(0);
}

runMigration().catch(console.error);
