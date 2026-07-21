const mongoose = require('mongoose');

const uri = "mongodb+srv://anandkumarar2020_db_user:BDpAQMriRvGJHrLs@bsg-cbt-cluster.4atelxi.mongodb.net/test?appName=bsg-cbt-cluster";

async function run() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  
  const users = await db.collection('users').find({ name: 'exam', role: 'Examiner' }).toArray();
  console.log("Examiner User:", JSON.stringify(users, null, 2));

  process.exit(0);
}

run();
