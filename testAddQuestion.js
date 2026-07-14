// No axios

async function testAddQuestion() {
  try {
    const mongoose = require('mongoose');
    const dotenv = require('dotenv');
    dotenv.config({ path: './.env' });
    
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to DB');
    
    // We need to use ts-node to require typescript models
    require('ts-node').register();
    const Exam = require('./src/models/Exam').default;
    const Question = require('./src/models/Question').default;
    
    const exam = await Exam.findById('6a55db42c22a3b3fb3562010');
    if (!exam) {
      console.log('Exam not found!');
      process.exit(1);
    }
    console.log('Found exam:', exam.title);
    
    const question = new Question({
      examId: exam._id,
      text: "Test Question",
      options: ["A", "B", "C", "D"],
      correctOptionIndex: 0,
      category: "Test"
    });
    
    const createdQuestion = await question.save();
    console.log('Saved question:', createdQuestion._id);
    
    exam.questions.push({
      questionId: createdQuestion._id,
      marks: 1
    });
    
    await exam.save();
    console.log('Saved exam with new question!');
    
    process.exit(0);
  } catch (error) {
    console.error('Error during test:', error.message);
    console.error(error);
    process.exit(1);
  }
}

testAddQuestion();
