const mongoose = require('mongoose');

async function check() {
  await mongoose.connect('mongodb+srv://anandkumarar2020_db_user:eDdZ09NaS2XciM5L@bsg-cbt-cluster.4atelxi.mongodb.net/bsg_cbt?appName=bsg-cbt-cluster');
  
  const User = mongoose.connection.collection('users');
  const users = await User.find({}).toArray();
  for (const u of users) {
    console.log(`User: ${u.name}, Email: ${u.email}, Role: ${u.role}, Status: ${u.status}, ID: ${u._id}`);
  }
  
  process.exit(0);
}

check().catch(console.error);
