'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import crypto from 'crypto';
import {
  saveProject as dbSaveProject,
  deleteProjectById,
  getProjectById,
  savePhotographyImage as dbSavePhotographyImage,
  deletePhotographyImageById,
  getPhotographyImageById,
} from './db';
import type { Project, PhotographyImage } from './definitions';
import { generateProjectThumbnail } from '@/ai/flows/generate-project-thumbnail';
import { supabase } from './supabase-client';

// --- File Handling Utility ---
async function deleteFile(fileUrl: string): Promise<void> {
  if (!fileUrl) return;
  try {
    const url = new URL(fileUrl);
    const pathParts = url.pathname.split('/');
    // The path is typically /storage/v1/object/public/bucket-name/folder/file.name
    const bucket = pathParts[4];
    const filePath = pathParts.slice(5).join('/');
    
    if (bucket && filePath) {
      await supabase.storage.from(bucket).remove([filePath]);
    }
  } catch (error: any) {
    console.error(`Failed to delete file at ${fileUrl}:`, error);
  }
}

// --- Schemas ---
const baseProjectSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, 'Title is required.'),
  description: z.string().min(1, 'Description is required.'),
  date: z.string().min(1, 'Date is required'),
  thumbnail: z.string().optional(),
  category: z.enum(['Film', 'Color Grading']),
});

const filmSchema = baseProjectSchema.extend({
  category: z.literal('Film'),
  youtubeVideoId: z.string().optional(),
  stills: z.string().transform(val => JSON.parse(val) as string[]).optional(),
});

const colorGradingSchema = baseProjectSchema.extend({
  category: z.literal('Color Grading'),
  beforeImageUrl: z.string().optional(),
  afterImageUrl: z.string().optional(),
});

// --- Project Actions ---

export async function saveProject(formData: FormData) {
  try {
    const category = formData.get('category') as Project['category'];
    const id = formData.get('id') as string | undefined;
    const projectId = id || crypto.randomBytes(8).toString('hex');

    let projectData: Partial<Project>;

    if (category === 'Film') {
      const validatedFields = filmSchema.safeParse({
        id: id,
        title: formData.get('title'),
        description: formData.get('description'),
        date: formData.get('date'),
        category: 'Film',
        youtubeVideoId: formData.get('youtubeVideoId') || undefined,
        thumbnail: formData.get('thumbnail'),
        stills: formData.get('stills'),
      });
      if (!validatedFields.success) throw new Error('Film project validation failed');
      projectData = validatedFields.data;
    } else if (category === 'Color Grading') {
      const validatedFields = colorGradingSchema.safeParse({
        id: id,
        title: formData.get('title'),
        description: formData.get('description'),
        date: formData.get('date'),
        category: 'Color Grading',
        beforeImageUrl: formData.get('beforeImageUrl'),
        afterImageUrl: formData.get('afterImageUrl'),
      });
      if (!validatedFields.success) throw new Error('Color Grading project validation failed');
      projectData = { ...validatedFields.data, thumbnail: validatedFields.data.afterImageUrl || validatedFields.data.beforeImageUrl || '' };
    } else {
      throw new Error('Invalid project category');
    }

    const finalProjectData: Project = {
        ...projectData,
        id: projectId,
    } as Project;

    // Delete old files if they are being replaced
    const existingProject = id ? await getProjectById(id) : undefined;
    if (existingProject) {
      if (finalProjectData.thumbnail && existingProject.thumbnail && finalProjectData.thumbnail !== existingProject.thumbnail) {
        await deleteFile(existingProject.thumbnail);
      }
      if (finalProjectData.beforeImageUrl && existingProject.beforeImageUrl && finalProjectData.beforeImageUrl !== existingProject.beforeImageUrl) {
        await deleteFile(existingProject.beforeImageUrl);
      }
      if (finalProjectData.afterImageUrl && existingProject.afterImageUrl && finalProjectData.afterImageUrl !== existingProject.afterImageUrl) {
        await deleteFile(existingProject.afterImageUrl);
      }
      // Stills are handled by replacing the whole array
      if (finalProjectData.stills && existingProject.stills && finalProjectData.stills.length > 0) {
        const newStillsSet = new Set(finalProjectData.stills);
        const stillsToDelete = existingProject.stills.filter(s => !newStillsSet.has(s));
        await Promise.all(stillsToDelete.map(url => deleteFile(url)));
      }
    }
    
    await dbSaveProject(finalProjectData);

    revalidatePath('/admin');
    revalidatePath('/');
    revalidatePath('/film');
    revalidatePath('/color-grading');
    revalidatePath(`/project/${projectId}`);
    
    return { success: true, message: 'Project saved successfully.' };

  } catch (e: any) {
    return { success: false, message: 'Failed to save project: ' + e.message };
  }
}

export async function deleteProject(formData: FormData) {
  const id = formData.get('id') as string;
  if (!id) return;
  try {
    const project = await getProjectById(id);
    if(project) {
        // Delete associated files from Supabase Storage
        const filesToDelete: (string | undefined)[] = [];
        filesToDelete.push(project.thumbnail);
        filesToDelete.push(project.beforeImageUrl);
        filesToDelete.push(project.afterImageUrl);
        if (project.stills) filesToDelete.push(...project.stills);

        for (const fileUrl of filesToDelete) {
          if (fileUrl) {
            await deleteFile(fileUrl);
          }
        }
    }
    await deleteProjectById(id);
  } catch (e) {
    console.error("Failed to delete project:", e)
  }
  revalidatePath('/admin');
  revalidatePath('/');
  revalidatePath('/film');
  revalidatePath('/color-grading');
}

// --- Photography Actions ---
export async function savePhotographyImage(prevState: any, formData: FormData) {
    const imageFile = formData.get('image') as File;
    const title = formData.get('title') as string;

    if (!imageFile || imageFile.size === 0) return { message: 'Image is required.' };
    if (!title) return { message: 'Title is required.' };

    const fileExtension = imageFile.name.split('.').pop();
    const fileName = `photography/${crypto.randomBytes(16).toString('hex')}.${fileExtension}`;
    
    try {
        const { error: uploadError } = await supabase.storage.from('photography').upload(fileName, imageFile);
        if (uploadError) throw new Error(uploadError.message);

        const { data: { publicUrl } } = supabase.storage.from('photography').getPublicUrl(fileName);

        const imageData: PhotographyImage = {
            id: crypto.randomBytes(8).toString('hex'),
            url: publicUrl,
            title: title,
            date: new Date().toISOString(),
        };
        await dbSavePhotographyImage(imageData);
    } catch (e: any) {
        return { message: 'Failed to save image: ' + e.message };
    }

    revalidatePath('/admin/photography');
    revalidatePath('/photography');
    return { message: 'Image uploaded successfully.' };
}


export async function deletePhotographyImage(formData: FormData) {
  const id = formData.get('id') as string;
  if (!id) return;
  try {
    const image = await getPhotographyImageById(id);
    if (image && image.url) {
      await deleteFile(image.url);
    }
    await deletePhotographyImageById(id);
  } catch (e) {
    console.error("Failed to delete photography image:", e)
  }
  revalidatePath('/admin/photography');
  revalidatePath('/photography');
}

// --- AI Thumbnail Action ---
export async function generateThumbnailAction(description: string, referenceImageDataUri?: string) {
    if (!description) {
        return { error: 'Description is required to generate a thumbnail.' };
    }
    try {
        const result = await generateProjectThumbnail({
            description,
            referenceImageDataUri,
        });
        return { thumbnailDataUri: result.thumbnailDataUri };
    } catch (error) {
        console.error('AI thumbnail generation failed:', error);
        return { error: 'Failed to generate AI thumbnail.' };
    }
}
