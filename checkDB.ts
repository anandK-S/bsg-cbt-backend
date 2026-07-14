async function run() {
  const mongoose = require('mongoose');
  const dotenv = require('dotenv');
  dotenv.config({ path: './.env' });
  
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');
  
  const Exam = require('./src/models/Exam').default;
  require('./src/models/Question'); // register Question model
  
  const exam = await Exam.findById('6a55db42c22a3b3fb3562010').populate('questions.questionId');
  if (!exam) {
    console.log('Exam not found!');
    process.exit(1);
  }
  
  console.log('Exam Questions Count:', exam.questions.length);
  if (exam.questions.length > 0) {
    console.log('First Question populated:', typeof exam.questions[0].questionId === 'object' && exam.questions[0].questionId !== null);
    console.log('First Question Data:', exam.questions[0].questionId);
  }
  
  process.exit(0);
}
run();
