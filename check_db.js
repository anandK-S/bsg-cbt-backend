const mongoose = require('mongoose');

const uri = "mongodb+srv://anandkumarar2020_db_user:BDpAQMriRvGJHrLs@bsg-cbt-cluster.4atelxi.mongodb.net/test?appName=bsg-cbt-cluster";

async function run() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  
  const attempts = await db.collection('examattempts').find({ status: 'In-Progress' }).toArray();
  console.log("Live Attempts:");
  console.log(JSON.stringify(attempts, null, 2));

  for (let attempt of attempts) {
    const exam = await db.collection('exams').findOne({ _id: attempt.examId });
    console.log("Exam for attempt:", attempt._id, exam ? exam.title : "Not found", "Creator:", exam ? exam.creatorId : "N/A");
  }

  process.exit(0);
}

run();
