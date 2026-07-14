async function run() {
  try {
    // 1. Login
    const loginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'exam@gmail.com',
        password: '123'
      })
    });
    
    if (!loginRes.ok) {
      console.log('Login failed', await loginRes.text());
      return;
    }
    
    const cookies = loginRes.headers.get('set-cookie');
    if (!cookies) {
      console.log('No cookies returned. Login failed or wrong credentials.');
      return;
    }
    
    const jwtCookie = cookies.split(';')[0];
    console.log('Logged in. Cookie:', jwtCookie);
    
    // 2. Add Question
    const addRes = await fetch(
      'http://localhost:5000/api/exams/6a55db42c22a3b3fb3562010/questions',
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Cookie': jwtCookie
        },
        body: JSON.stringify({
          text: 'What is the color of the sky?',
          options: ['Blue', 'Red', 'Green', 'Yellow'],
          correctOptionIndex: 0,
          category: 'General',
          marks: 1
        })
      }
    );
    
    console.log('Add Question Response:', addRes.status, await addRes.json());
    
    // 3. Get Exam
    const getRes = await fetch(
      'http://localhost:5000/api/exams/6a55db42c22a3b3fb3562010',
      { headers: { Cookie: jwtCookie } }
    );
    
    const getData = await getRes.json();
    console.log('Exam Questions Count:', getData.questions?.length);
    if (getData.questions?.length > 0) {
      console.log('First Question populated:', !!getData.questions[0].questionId);
      console.log('First Question Data:', getData.questions[0].questionId);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

run();
