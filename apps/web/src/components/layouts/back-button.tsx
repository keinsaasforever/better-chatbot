"use client";

import { Button } from "ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

interface BackButtonProps extends React.HTMLAttributes<HTMLAnchorElement> {
  returnUrl: string;
  title: string;
}

export function BackButton({ returnUrl, title, ...props }: BackButtonProps) {
  return (
    <Link href={returnUrl} {...props}>
      <Button variant="ghost" size="sm" className="hover:bg-muted">
        <ArrowLeft className="mr-2 h-4 w-4" />
        {title}
      </Button>
    </Link>
  );
}
