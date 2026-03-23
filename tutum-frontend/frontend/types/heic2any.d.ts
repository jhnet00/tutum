declare module "heic2any" {
  interface Heic2AnyOptions {
    blob: Blob;
    toType?: string;
    quality?: number;
  }

  type Heic2AnyResult = Blob | Blob[];

  export default function heic2any(options: Heic2AnyOptions): Promise<Heic2AnyResult>;
}
