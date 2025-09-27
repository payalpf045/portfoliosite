'use server';

import { kv } from '@vercel/kv';
import type { Project, PhotographyImage } from './definitions';

const PROJECTS_KEY = 'projects';
const PHOTOGRAPHY_KEY = 'photography_images';

// --- Generic Data Access Functions ---

async function getAll<T>(key: string): Promise<T[]> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    console.log("Vercel KV environment variables not found, returning empty array. This is expected for local development if you haven't connected Vercel CLI.");
    return [];
  }
  const items = await kv.get<T[]>(key);
  return items || [];
}

async function getItemById<T extends { id: string }>(key: string, id: string): Promise<T | undefined> {
  const items = await getAll<T>(key);
  return items.find((item) => item.id === id);
}

async function saveItem<T extends { id: string }>(key: string, item: T): Promise<void> {
  const items = await getAll<T>(key);
  const existingIndex = items.findIndex((i) => i.id === item.id);

  if (existingIndex > -1) {
    items[existingIndex] = item;
  } else {
    items.unshift(item);
  }
  await kv.set(key, items);
}

async function deleteItemById<T extends { id: string }>(key: string, id: string): Promise<void> {
  let items = await getAll<T>(key);
  items = items.filter((item) => item.id !== id);
  await kv.set(key, items);
}


// --- Project-Specific Functions ---

export async function getProjects(): Promise<Project[]> {
  const projects = await getAll<Project>(PROJECTS_KEY);
  return projects.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function getProjectById(id: string): Promise<Project | undefined> {
  return getItemById<Project>(PROJECTS_KEY, id);
}

export async function saveProject(project: Project): Promise<void> {
  return saveItem<Project>(PROJECTS_KEY, project);
}

export async function deleteProjectById(id: string): Promise<void> {
  return deleteItemById<Project>(PROJECTS_KEY, id);
}


// --- Photography-Specific Functions ---

export async function getPhotographyImages(): Promise<PhotographyImage[]> {
  const images = await getAll<PhotographyImage>(PHOTOGRAPHY_KEY);
  return images.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function getPhotographyImageById(id: string): Promise<PhotographyImage | undefined> {
  return getItemById<PhotographyImage>(PHOTOGRAPHY_KEY, id);
}

export async function savePhotographyImage(image: PhotographyImage): Promise<void> {
  return saveItem<PhotographyImage>(PHOTOGRAPHY_KEY, image);
}

export async function deletePhotographyImageById(id: string): Promise<void> {
  return deleteItemById<PhotographyImage>(PHOTOGRAPHY_KEY, id);
}
