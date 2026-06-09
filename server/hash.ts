import bcrypt from 'bcryptjs';

async function run() {
  const hash = await bcrypt.hash('Mohit@123', 10);
  console.log(hash);
}

run();