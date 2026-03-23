import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const authToken = request.cookies.get('auth_token');
    const isAuthenticated = !!authToken;

    // Protected routes - require authentication
    const protectedRoutes = [
        '/portfolio',
        '/direct-input',
        '/confirm-input',
        '/asset-upload',
        '/admin',
    ];

    // Auth routes - redirect to portfolio if already logged in
    const authRoutes = ['/login', '/register'];

    // Check if current path is protected
    const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route));
    const isAuthRoute = authRoutes.some(route => pathname.startsWith(route));

    // Redirect unauthenticated users from protected routes to login
    if (isProtectedRoute && !isAuthenticated) {
        const loginUrl = new URL('/login', request.url);
        loginUrl.searchParams.set('callbackUrl', pathname);
        return NextResponse.redirect(loginUrl);
    }

    // Redirect authenticated users from login/register to portfolio
    if (isAuthRoute && isAuthenticated) {
        return NextResponse.redirect(new URL('/portfolio/asset', request.url));
    }

    // Redirect authenticated users from main page to portfolio
    // if (pathname === '/' && isAuthenticated) {
    //     return NextResponse.redirect(new URL('/portfolio/asset', request.url));
    // }

    return NextResponse.next();
}

export const config = {
    matcher: [
        '/',
        '/portfolio/:path*',
        '/direct-input/:path*',
        '/confirm-input/:path*',
        '/asset-upload/:path*',
        '/admin/:path*',
        '/login',
        '/register',
    ],
};
