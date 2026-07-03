import { selectionsRepository } from '@/repositories';

export async function removeSelection(selectionId: string) {
  const sel = await selectionsRepository.findById(selectionId);
  if (!sel) throw new Error('Selection not found');
  await selectionsRepository.delete(selectionId);
  return { success: true };
}