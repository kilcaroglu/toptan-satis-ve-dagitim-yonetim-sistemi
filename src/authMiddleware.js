import jwt from "jsonwebtoken"

export function authMiddleware(req, res, next) {
    const authorization = req.headers.authorization;

    if (!authorization) {
        return res.status(401).json({
            message: "Token bulunamadı"
        });
    }

    const token = authorization.replace("Bearer ", "");

    try{
        const decoded = jwt.verify(
            token, 
            process.env.JWT_SECRET
        );

        req.user = decoded;

        next();
    }

    catch (error) {
        return res.status(401).json({
            message: "Geçersiz token"
        });
    }

}


export function roleMiddleware(...allowedRoles) {
    return (req, res, next) => {
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                message: "Bu işlem için yetkiniz yok"
            });
        }

        next();
    };
}