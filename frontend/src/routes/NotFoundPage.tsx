import React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export const NotFoundPage: React.FC = () => {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="text-6xl font-black text-muted-foreground">404</h1>
      <h2 className="mt-4 text-2xl font-bold">Page Not Found</h2>
      <p className="mt-2 text-muted-foreground">The requested route does not exist.</p>
      <Link to="/" className="mt-6">
        <Button>Return to Home</Button>
      </Link>
    </div>
  );
};

