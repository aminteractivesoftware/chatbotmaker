import { extractCharacterFromPng } from './utils/pngMetadata.js';
import fs from 'fs/promises';

const pngPath = '/Users/adammercier/Documents/AM Interactive Software/VSCode/ChatbotMaker/Examples/main_karael-the-angel-99f1341bd86e_spec_v2.png';

try {
  console.log('Extracting character data from PNG...');
  const characterData = await extractCharacterFromPng(pngPath);
  console.log('Successfully extracted character data:');
  console.log(JSON.stringify(characterData, null, 2).substring(0, 2000));

  // Save to file for inspection
  await fs.writeFile('extracted-character.json', JSON.stringify(characterData, null, 2));
  console.log('\nFull data saved to extracted-character.json');
} catch (error) {
  console.error('Error:', error.message);
}
