import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { supabase } from "./supabase-client";
import crypto from 'crypto';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function uploadFileWithProgress(
  file: File,
  bucket: string,
  onProgress: (percentage: number) => void
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const fileExtension = file.name.split('.').pop();
    const fileName = `${crypto.randomBytes(16).toString('hex')}.${fileExtension}`;
    
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      return reject(new Error(`Supabase upload error: ${error.message}`));
    }
    
    // The public URL is constructed manually as the upload method doesn't provide it directly
    // when not using the deprecated `createSignedUrl` approach.
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(fileName);
    
    // Since supabase JS client v2 doesn't support progress on upload directly,
    // we will simulate progress for better UX. In a real world scenario with a different http client
    // we could monitor the upload. Here we'll just complete it.
    onProgress(100);
    resolve(publicUrl);
  });
}
