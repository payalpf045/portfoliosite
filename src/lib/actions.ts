'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
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
    // Expected URL format: /storage/v1/object/public/bucket-name/file-path
    const bucket = pathParts[4];
    const filePath = pathParts.slice(5).join('/');
    
    if (bucket && filePath) {
      const { error } = await supabase.storage.from(bucket).remove([filePath]);
      if (error) throw error;
    }
  } catch (error: any) {
    console.error(`Failed to delete file at ${fileUrl}:`, error.message);
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
  youtubeVideoId: z.string().optional().default(''),
  stills: z.string().transform(val => JSON.parse(val) as string[]).optional().default([]),
});

const colorGradingSchema = baseProjectSchema.extend({
  category: z.literal('Color Grading'),
  beforeImageUrl: z.string().optional().default(''),
  afterImageUrl: z.string().optional().default(''),
});

// --- Project Actions ---

export async function saveProject(formData: FormData) {
  try {
    const category = formData.get('category') as Project['category'];
    const id = formData.get('id') as string | undefined;
    const projectId = id || crypto.randomUUID();

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
      if (!validatedFields.success) {
        console.error(validatedFields.error.flatten().fieldErrors);
        throw new Error('Film project validation failed: ' + JSON.stringify(validatedFields.error.flatten().fieldErrors));
      }
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
        thumbnail: formData.get('thumbnail'),
      });
      if (!validatedFields.success) {
        console.error(validatedFields.error.flatten().fieldErrors);
        throw new Error('Color Grading project validation failed: ' + JSON.stringify(validatedFields.error.flatten().fieldErrors));
      }
      projectData = { ...validatedFields.data, thumbnail: formData.get('thumbnail') as string || '' };
    } else {
      throw new Error('Invalid project category');
    }

    const finalProjectData: Project = {
        ...projectData,
        id: projectId,
    } as Project;

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
      if (finalProjectData.stills && existingProject.stills) {
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
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

const imageSchema = z.object({
  image: z
    .any()
    .refine((file) => file?.size <= MAX_FILE_SIZE, `Max image size is 25MB.`)
    .refine(
      (file) => ACCEPTED_IMAGE_TYPES.includes(file?.type),
      'Only .jpg, .jpeg, .png and .webp formats are supported.'
    ),
  title: z.string().min(1, 'Title is required.'),
});


export async function savePhotographyImage(prevState: any, formData: FormData) {
    const validatedFields = imageSchema.safeParse({
        image: formData.get('image'),
        title: formData.get('title'),
    });

    if (!validatedFields.success) {
        return { message: validatedFields.error.flatten().fieldErrors.image?.[0] || validatedFields.error.flatten().fieldErrors.title?.[0] || 'Validation failed.' };
    }

    const { image: imageFile, title } = validatedFields.data;

    const fileExtension = imageFile.name.split('.').pop();
    const fileName = `photography/${crypto.randomUUID()}.${fileExtension}`;
    
    try {
        const { error: uploadError } = await supabase.storage.from('photography').upload(fileName, imageFile);
        if (uploadError) throw new Error(uploadError.message);

        const { data: { publicUrl } } = supabase.storage.from('photography').getPublicUrl(fileName);

        const imageData: PhotographyImage = {
            id: crypto.randomUUID(),
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


// --- Signed URL Action ---
export async function createSignedUploadUrl(path: string, bucket: string, contentType: string) {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(path);

    if (error) {
      throw error;
    }
    
    return { signedUrl: data.signedUrl };
  } catch (error: any) {
    return { error: 'Failed to create signed URL: ' + error.message };
  }
}

    