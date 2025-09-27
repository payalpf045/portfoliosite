'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

export function SubmitButton({ isSubmitting }: { isSubmitting?: boolean }) {
  const { pending } = useFormStatus();
  const isDisabled = isSubmitting || pending;

  return (
    <Button type="submit" disabled={isDisabled}>
      {isDisabled ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Saving...
        </>
      ) : (
        'Save Project'
      )}
    </Button>
  );
}
