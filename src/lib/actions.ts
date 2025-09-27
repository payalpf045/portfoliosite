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
import { put, del } from '@vercel/blob';

// --- File Handling Utility ---
async function saveFile(file: File, folder: string): Promise<string> {
  if (!file) {
    throw new Error('No file provided to save.');
  }
  const fileExtension = file.name.split('.').pop();
  const fileName = `${folder}/${crypto.randomBytes(16).toString('hex')}.${fileExtension}`;

  const blob = await put(fileName, file, {
    access: 'public',
  });

  return blob.url;
}

async function deleteFile(fileUrl: string): Promise<void> {
  if (!fileUrl) return;
  try {
    await del(fileUrl);
  } catch (error: any) {
    // Vercel Blob's del throws an error if the file doesn't exist, so we can ignore not found errors.
    if (error.code !== 'not_found') {
        console.error(`Failed to delete file at ${fileUrl}:`, error);
    }
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

const fileSchema = z
  .instanceof(File)
  .refine((file) => file.size > 0, 'File is required.')
  .refine((file) => file.size <= 5 * 1024 * 1024, `Max file size is 5MB.`)
  .refine(
    (file) => ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type),
    'Only .jpg, .jpeg, .png and .webp formats are supported.'
  );

const filmSchema = baseProjectSchema.extend({
  category: z.literal('Film'),
  youtubeVideoId: z.string().optional(),
  stills: z.array(z.string()).optional(),
});

const colorGradingSchema = baseProjectSchema.extend({
  category: z.literal('Color Grading'),
  beforeImageUrl: z.string().optional(),
  afterImageUrl: z.string().optional(),
});

// --- Project Actions ---

export async function saveProject(prevState: any, formData: FormData) {
  const category = formData.get('category') as Project['category'];
  
  if (category === 'Film') {
    return saveFilmProject(formData);
  } else if (category === 'Color Grading') {
    return saveColorGradingProject(formData);
  }
  
  return { message: 'Invalid project category.', success: false };
}

async function saveFilmProject(formData: FormData) {
  const validatedFields = filmSchema.safeParse({
    id: formData.get('id') || undefined,
    title: formData.get('title'),
    description: formData.get('description'),
    date: formData.get('date'),
    category: 'Film',
    youtubeVideoId: formData.get('youtubeVideoId') || undefined,
  });

  if (!validatedFields.success) {
    return {
      message: 'Validation failed: ' + validatedFields.error.flatten().fieldErrors,
      success: false,
    };
  }

  const { id, ...data } = validatedFields.data;
  const projectId = id || crypto.randomBytes(8).toString('hex');
  
  const youtubeId = data.youtubeVideoId ? data.youtubeVideoId.trimEnd() : '';

  try {
    const existingProject = id ? await getProjectById(id) : undefined;
    let newThumbnailUrl = existingProject?.thumbnail || formData.get('thumbnail') as string || '';
    
    const thumbnailFile = formData.get('thumbnailFile') as File;
    if (thumbnailFile && thumbnailFile.size > 0) {
      const thumbValidation = fileSchema.safeParse(thumbnailFile);
      if (!thumbValidation.success) throw new Error('Thumbnail validation failed');
      if (existingProject?.thumbnail) {
        await deleteFile(existingProject.thumbnail);
      }
      newThumbnailUrl = await saveFile(thumbnailFile, 'project-thumbnails');
    } else if(newThumbnailUrl.startsWith('data:')) {
      // Handle AI generated thumbnail
      const response = await fetch(newThumbnailUrl);
      const blob = await response.blob();
      const file = new File([blob], "thumbnail.png", { type: blob.type });
      if (existingProject?.thumbnail) {
        await deleteFile(existingProject.thumbnail);
      }
      newThumbnailUrl = await saveFile(file, 'project-thumbnails');
    }
    
    const stillFiles = formData.getAll('stills') as File[];
    let newStillsUrls = existingProject?.stills || [];
    if (stillFiles.some(f => f.size > 0)) {
        if (existingProject?.stills) {
          await Promise.all(existingProject.stills.map(url => deleteFile(url)));
        }
        newStillsUrls = await Promise.all(stillFiles.map(file => saveFile(file, `stills/${projectId}`)));
    }

    const projectData: Project = {
      ...data,
      id: projectId,
      thumbnail: newThumbnailUrl,
      stills: newStillsUrls,
      youtubeVideoId: youtubeId,
    };
    
    await dbSaveProject(projectData);
  } catch (e: any) {
    return { message: 'Failed to save project: ' + e.message, success: false };
  }
  revalidatePath('/admin');
  revalidatePath(`/project/${projectId}`);
  revalidatePath('/');
  revalidatePath('/film');
  revalidatePath('/color-grading');
  redirect('/admin');
}

async function saveColorGradingProject(formData: FormData) {
    const validatedFields = colorGradingSchema.safeParse({
        id: formData.get('id') || undefined,
        title: formData.get('title'),
        description: formData.get('description'),
        date: formData.get('date'),
        category: 'Color Grading',
    });

    if (!validatedFields.success) {
        return {
          message: 'Validation failed: ' + JSON.stringify(validatedFields.error.flatten().fieldErrors),
          success: false,
        };
    }

    const { id, ...data } = validatedFields.data;
    const projectId = id || crypto.randomBytes(8).toString('hex');

    try {
        const existingProject = id ? await getProjectById(id) : undefined;
        let beforeUrl = existingProject?.beforeImageUrl;
        let afterUrl = existingProject?.afterImageUrl;

        const beforeFile = formData.get('beforeImage') as File;
        if (beforeFile && beforeFile.size > 0) {
            if (beforeUrl) await deleteFile(beforeUrl);
            beforeUrl = await saveFile(beforeFile, `color-grading/${projectId}`);
        }

        const afterFile = formData.get('afterImage') as File;
        if (afterFile && afterFile.size > 0) {
            if (afterUrl) await deleteFile(afterUrl);
            afterUrl = await saveFile(afterFile, `color-grading/${projectId}`);
        }

        if (!id && (!beforeFile || beforeFile.size === 0 || !afterFile || afterFile.size === 0)) {
          throw new Error('Before and After images are required for new color grading projects.');
        }

        const projectData: Project = {
            ...data,
            id: projectId,
            beforeImageUrl: beforeUrl,
            afterImageUrl: afterUrl,
            thumbnail: afterUrl || beforeUrl, // Use after image as thumbnail
        };

        await dbSaveProject(projectData);
    } catch (e: any) {
        return { message: 'Failed to save project: ' + e.message, success: false };
    }
    revalidatePath('/admin');
    revalidatePath(`/project/${projectId}`);
    revalidatePath('/');
    revalidatePath('/film');
    revalidatePath('/color-grading');
    redirect('/admin');
}

export async function deleteProject(formData: FormData) {
  const id = formData.get('id') as string;
  if (!id) return;
  try {
    const project = await getProjectById(id);
    if(project) {
        // Delete associated files from Vercel Blob
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
    // handle error
    console.error("Failed to delete project:", e)
    // We can show an error to the user here if needed
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
    
    const imageId = crypto.randomBytes(8).toString('hex');
    try {
        const imageUrl = await saveFile(imageFile, 'photography');
        const imageData: PhotographyImage = {
            id: imageId,
            url: imageUrl,
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
