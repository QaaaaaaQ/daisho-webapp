import {validateDocument} from './domain.js';
import {pcaInputIssues} from './input-quality.js';

// Validate the exact draft that will be saved, then invoke its persistence callback.
export async function saveValidatedDocument(doc, customers, products, save) {
  const validationError=validateDocument(doc);
  if(validationError)return {validationError};
  const issues=pcaInputIssues(doc,customers,products);
  if(issues.length)return {issues};
  return {saved:await save(doc)};
}
