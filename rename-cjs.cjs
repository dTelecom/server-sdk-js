const fs = require('fs');
const path = require('path');

function renameJsToCjs(dir) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      renameJsToCjs(filePath);
    } else if (file.endsWith('.js')) {
      const newPath = filePath.replace('.js', '.cjs');
      fs.renameSync(filePath, newPath);
      
      // Update imports in the file content
      if (fs.existsSync(newPath)) {
        let content = fs.readFileSync(newPath, 'utf8');
        
        // Update require statements for relative paths
        content = content.replace(/require\(['"](\.[^'"]+)['"](\))/g, (match, p1, p2) => {
          // Handle paths that go up directories
          if (p1.startsWith('../')) {
            return `require('${p1.replace(/\.js$/, '.cjs')}'${p2}`;
          }
          
          // If the import doesn't have an extension, add .cjs
          if (!p1.endsWith('.js') && !p1.endsWith('.cjs')) {
            return `require('${p1}.cjs'${p2}`;
          }
          // If it ends with .js, replace with .cjs
          return `require('${p1.replace(/\.js$/, '.cjs')}'${p2}`;
        });

        // Update from statements for relative paths
        content = content.replace(/from ['"](\.[^'"]+)['"]/g, (match, p1) => {
          // Handle paths that go up directories
          if (p1.startsWith('../')) {
            return `from '${p1.replace(/\.js$/, '.cjs')}'`;
          }
          
          // If the import doesn't have an extension, add .cjs
          if (!p1.endsWith('.js') && !p1.endsWith('.cjs')) {
            return `from '${p1}.cjs'`;
          }
          // If it ends with .js, replace with .cjs
          return `from '${p1.replace(/\.js$/, '.cjs')}'`;
        });

        fs.writeFileSync(newPath, content);
      }
    }
  });
}

// Start the renaming process in the dist/cjs directory
const cjsDir = path.join(__dirname, 'dist', 'cjs');
if (fs.existsSync(cjsDir)) {
  renameJsToCjs(cjsDir);
  console.log('Successfully renamed .js files to .cjs in dist/cjs directory');
} else {
  console.error('dist/cjs directory not found');
} 