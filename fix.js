const fs = require('fs');
const path = require('path');
const dir = './src/controllers';

fs.readdirSync(dir).forEach(file => {
  if (!file.endsWith('.ts')) return;
  const p = path.join(dir, file);
  let cnt = fs.readFileSync(p, 'utf8');

  // Fix the inline ifs
  cnt = cnt.replace(/if \((.*?)\) res\.status\((.*?)\)\.json\(([\s\S]*?)\); return;/g, 'if ($1) { res.status($2).json($3); return; }');
  
  // Fix the double returns created by previous replace (where there was already { })
  cnt = cnt.replace(/return;\r?\n\s*return;/g, 'return;');
  
  fs.writeFileSync(p, cnt);
});
console.log('Fixed controllers');
