'use server';

import { supabase } from './supabase-client';
import type { Project, PhotographyImage } from './definitions';

// --- Project-Specific Functions ---

export async function getProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select(
      'id, title, description, category, thumbnail, date, "youtubeVideoId", stills, "beforeImageUrl", "afterImageUrl"'
    )
    .order('date', { ascending: false });

  if (error) {
    console.error('Supabase error getting projects:', error);
    return [];
  }
  return data || [];
}

export async function getProjectById(id: string): Promise<Project | undefined> {
  const { data, error } = await supabase
    .from('projects')
    .select(
      'id, title, description, category, thumbnail, date, "youtubeVideoId", stills, "beforeImageUrl", "afterImageUrl"'
    )
    .eq('id', id)
    .single();

  if (error) {
    console.error(`Supabase error getting project by id ${id}:`, error);
    return undefined;
  }
  return data || undefined;
}

export async function saveProject(project: Project): Promise<void> {
  const { error } = await supabase.from('projects').upsert(project);

  if (error) {
    console.error('Supabase error saving project:', error);
    throw new Error('Failed to save project to Supabase.');
  }
}

export async function deleteProjectById(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id);

  if (error) {
    console.error('Supabase error deleting project:', error);
    throw new Error('Failed to delete project from Supabase.');
  }
}

// --- Photography-Specific Functions ---

export async function getPhotographyImages(): Promise<PhotographyImage[]> {
    const { data, error } = await supabase
        .from('photography_images')
        .select('*')
        .order('date', { ascending: false });
    
    if (error) {
        console.error('Supabase error getting photography images:', error);
        return [];
    }
    return data || [];
}

export async function getPhotographyImageById(id: string): Promise<PhotographyImage | undefined> {
    const { data, error } = await supabase
        .from('photography_images')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        console.error(`Supabase error getting photography image by id ${id}:`, error);
        return undefined;
    }
    return data || undefined;
}

export async function savePhotographyImage(image: PhotographyImage): Promise<void> {
    const { error } = await supabase.from('photography_images').upsert(image);

    if (error) {
        console.error('Supabase error saving photography image:', error);
        throw new Error('Failed to save photography image to Supabase.');
    }
}

export async function deletePhotographyImageById(id: string): Promise<void> {
    const { error } = await supabase.from('photography_images').delete().eq('id', id);

    if (error) {
        console.error('Supabase error deleting photography image:', error);
        throw new Error('Failed to delete photography image from Supabase.');
    }
}
