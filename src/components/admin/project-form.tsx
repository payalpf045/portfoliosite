'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Project } from '@/lib/definitions';
import { saveProject, generateThumbnailAction } from '@/lib/actions';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { SubmitButton } from './submit-button';
import Image from 'next/image';
import { fileToDataUri } from '@/lib/utils';
import { Sparkles } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/lib/supabase-client';
import crypto from 'crypto';

interface ProjectFormProps {
  project?: Project;
}

// Client-side direct upload function
async function uploadFileWithProgress(
  file: File,
  bucket: string,
  onProgress: (percentage: number) => void
): Promise<string> {
    const fileExtension = file.name.split('.').pop();
    const fileName = `${crypto.randomBytes(16).toString('hex')}.${fileExtension}`;
    
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      throw new Error(`Supabase upload error: ${error.message}`);
    }
    
    // The public URL is constructed manually.
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(fileName);
    
    // Simulate progress as Supabase v2 client doesn't support it directly in this way
    // In a real app, you might use a different method or library for progress.
    // For now, we show progress for UX but the await above handles the actual upload.
    onProgress(100);
    return publicUrl;
}


export default function ProjectForm({ project }: ProjectFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [category, setCategory] = useState<string>(project?.category || 'Film');
  
  // Previews
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(project?.thumbnail || null);
  const [beforeImagePreview, setBeforeImagePreview] = useState<string | null>(project?.beforeImageUrl || null);
  const [afterImagePreview, setAfterImagePreview] = useState<string | null>(project?.afterImageUrl || null);

  // File inputs
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [stillsFiles, setStillsFiles] = useState<FileList | null>(null);
  const [beforeImageFile, setBeforeImageFile] = useState<File | null>(null);
  const [afterImageFile, setAfterImageFile] = useState<File | null>(null);
  
  // AI Generation
  const [isGenerating, startTransition] = useTransition();
  const [descriptionForAI, setDescriptionForAI] = useState(project?.description || '');
  const [referenceImageFile, setReferenceImageFile] = useState<File | null>(null);
  const [aiGeneratedThumbnail, setAiGeneratedThumbnail] = useState<string>('');
  
  // Upload Progress
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState('');

  const { toast } = useToast();
  const router = useRouter();

  const handleGenerateThumbnail = () => {
    startTransition(async () => {
      let refImageDataUri: string | undefined = undefined;
      if (referenceImageFile) {
        refImageDataUri = await fileToDataUri(referenceImageFile);
      }
      const result = await generateThumbnailAction(descriptionForAI, refImageDataUri);
      if (result.thumbnailDataUri) {
        setThumbnailPreview(result.thumbnailDataUri);
        setAiGeneratedThumbnail(result.thumbnailDataUri);
        setThumbnailFile(null); // Clear file input if AI thumb is generated
        toast({ title: 'Thumbnail generated successfully!' });
      } else if (result.error) {
        toast({ title: 'Error', description: result.error, variant: 'destructive' });
      }
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setter: (file: File | null) => void, previewSetter: (url: string | null) => void) => {
    const file = e.target.files?.[0] || null;
    setter(file);
    if (file) {
      previewSetter(URL.createObjectURL(file));
      if (setter === setThumbnailFile) {
        setAiGeneratedThumbnail('');
      }
    } else {
      previewSetter(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setUploadProgress(0);
    setUploadMessage('');

    const currentFormData = new FormData(e.currentTarget);

    try {
      let uploadedThumbnailUrl = project?.thumbnail || '';
      let uploadedStillsUrls = project?.stills || [];
      let uploadedBeforeImageUrl = project?.beforeImageUrl || '';
      let uploadedAfterImageUrl = project?.afterImageUrl || '';

      // --- Direct Client-Side Uploads with Progress ---

      if (aiGeneratedThumbnail) {
        setUploadMessage('Uploading AI thumbnail...');
        const response = await fetch(aiGeneratedThumbnail);
        const blob = await response.blob();
        const file = new File([blob], 'thumbnail.png', { type: blob.type });
        uploadedThumbnailUrl = await uploadFileWithProgress(file, 'project-thumbnails', setUploadProgress);
      } else if (thumbnailFile) {
        setUploadMessage('Uploading thumbnail...');
        uploadedThumbnailUrl = await uploadFileWithProgress(thumbnailFile, 'project-thumbnails', setUploadProgress);
      }

      if (stillsFiles && stillsFiles.length > 0) {
        uploadedStillsUrls = []; // Clear old stills if new ones are uploaded
        for (let i = 0; i < stillsFiles.length; i++) {
          const file = stillsFiles[i];
          setUploadMessage(`Uploading still ${i + 1}/${stillsFiles.length}...`);
          const percentage = ((i + 1) / stillsFiles.length) * 100;
          const url = await uploadFileWithProgress(file, 'stills', () => setUploadProgress(percentage));
          uploadedStillsUrls.push(url);
        }
      }
      
      if (beforeImageFile) {
        setUploadMessage('Uploading before image...');
        uploadedBeforeImageUrl = await uploadFileWithProgress(beforeImageFile, 'color-grading', setUploadProgress);
      }
      
      if (afterImageFile) {
        setUploadMessage('Uploading after image...');
        uploadedAfterImageUrl = await uploadFileWithProgress(afterImageFile, 'color-grading', setUploadProgress);
      }
      
      setUploadMessage('Saving project details...');
      
      // We are creating a new FormData object to pass to the server action.
      // This new FormData will only contain the text fields and the URLs of the uploaded files, not the files themselves.
      const serverFormData = new FormData();
      serverFormData.append('id', project?.id || '');
      serverFormData.append('title', currentFormData.get('title') as string);
      serverFormData.append('description', currentFormData.get('description') as string);
      serverFormData.append('date', currentFormData.get('date') as string);
      serverFormData.append('category', category);

      serverFormData.append('thumbnail', uploadedThumbnailUrl);
      serverFormData.append('stills', JSON.stringify(uploadedStillsUrls));
      serverFormData.append('beforeImageUrl', uploadedBeforeImageUrl);
      serverFormData.append('afterImageUrl', uploadedAfterImageUrl);
      serverFormData.append('youtubeVideoId', currentFormData.get('youtubeVideoId') as string || '');


      const result = await saveProject(serverFormData);

      if (result.success) {
        toast({ title: 'Success', description: result.message });
        router.push('/admin');
      } else {
        throw new Error(result.message);
      }

    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'An unknown error occurred.', variant: 'destructive' });
      setIsSubmitting(false);
      setUploadProgress(0);
      setUploadMessage('');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardContent className="p-6 space-y-6">
          {project && <input type="hidden" name="id" value={project.id} />}
          
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" defaultValue={project?.title} required disabled={isSubmitting} />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" defaultValue={project?.description} required onChange={(e) => setDescriptionForAI(e.target.value)} disabled={isSubmitting} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select name="category" value={category} onValueChange={setCategory} required disabled={isSubmitting}>
                <SelectTrigger id="category">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Film">Film</SelectItem>
                  <SelectItem value="Color Grading">Color Grading</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" name="date" type="date" defaultValue={project ? new Date(project.date).toISOString().split('T')[0] : ''} required disabled={isSubmitting} />
            </div>
          </div>

          {category === 'Film' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="youtubeVideoId">YouTube Video ID</Label>
                <Input id="youtubeVideoId" name="youtubeVideoId" defaultValue={project?.youtubeVideoId || ''} disabled={isSubmitting} />
              </div>
              
              <div className="space-y-4 rounded-lg border p-4">
                  <Label>Thumbnail</Label>
                  {thumbnailPreview && (
                      <div className="w-48 aspect-video relative">
                          <Image src={thumbnailPreview} alt="Thumbnail preview" fill className="object-cover rounded-md" />
                      </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="thumbnailFile">Upload Thumbnail</Label>
                    <Input id="thumbnailFile" name="thumbnailFile" type="file" accept="image/*" onChange={(e) => handleFileChange(e, setThumbnailFile, setThumbnailPreview)} disabled={isSubmitting} />
                  </div>
                  <div className="text-sm text-muted-foreground text-center my-2">OR</div>
                  <div className="space-y-2">
                      <Label>Generate with AI</Label>
                      <div className="flex items-center gap-2">
                        <Input type="file" accept="image/*" onChange={(e) => setReferenceImageFile(e.target.files?.[0] || null)} disabled={isSubmitting || isGenerating} />
                        <Button type="button" onClick={handleGenerateThumbnail} disabled={isSubmitting || isGenerating} variant="outline">
                          <Sparkles className={`mr-2 h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} />
                          {isGenerating ? 'Generating...' : 'Generate'}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">Optionally provide a reference image for the AI.</p>
                  </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="stills">Screenshot Stills</Label>
                <Input id="stills" name="stills" type="file" multiple accept="image/*" onChange={(e) => setStillsFiles(e.target.files)} disabled={isSubmitting} />
                {project?.stills && !stillsFiles && (
                    <div className="flex gap-2 mt-2">
                        {project.stills.map(still => (
                            <Image key={still} src={still} alt="still" width={100} height={56} className="rounded-md object-cover"/>
                        ))}
                    </div>
                )}
              </div>
            </div>
          )}

          {category === 'Color Grading' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="beforeImage">Before Image</Label>
                <Input id="beforeImage" name="beforeImage" type="file" accept="image/*" onChange={(e) => handleFileChange(e, setBeforeImageFile, setBeforeImagePreview)} disabled={isSubmitting} />
                {beforeImagePreview && <Image src={beforeImagePreview} alt="before" width={200} height={112} className="rounded-md object-cover mt-2"/>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="afterImage">After Image</Label>
                <Input id="afterImage" name="afterImage" type="file" accept="image/*" onChange={(e) => handleFileChange(e, setAfterImageFile, setAfterImagePreview)} disabled={isSubmitting} />
                {afterImagePreview && <Image src={afterImagePreview} alt="after" width={200} height={112} className="rounded-md object-cover mt-2"/>}
              </div>
            </div>
          )}

          {isSubmitting && (
            <div className="space-y-2">
              <Label>{uploadMessage}</Label>
              <Progress value={uploadProgress} />
            </div>
          )}

        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => router.back()} disabled={isSubmitting}>Cancel</Button>
          <SubmitButton isSubmitting={isSubmitting} />
        </CardFooter>
      </Card>
    </form>
  );
}
